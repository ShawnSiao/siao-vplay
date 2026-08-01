use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{
    learning::{self, LearningError},
    store::{ProjectStore, StoreError},
    translation::{self, TranslationError},
    understanding::{self, UnderstandingError},
};

const RESULT_FILE: &str = "result.json";
const ATTEMPT_FILE: &str = ".result.attempt.json";
const MAX_AUTO_HASH_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum ExternalHandoffError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Translation(#[from] TranslationError),
    #[error(transparent)]
    Understanding(#[from] UnderstandingError),
    #[error(transparent)]
    Learning(#[from] LearningError),
    #[error("外部 Agent 任务类型无效：{0}")]
    InvalidTaskKind(String),
    #[error("外部 Agent 任务不是可回传的手动任务")]
    InvalidTask,
    #[error("外部 Agent 返回目录无效：{0}")]
    InvalidResultDirectory(String),
    #[error("文件系统错误：{0}")]
    FileSystem(#[from] io::Error),
}

impl ExternalHandoffError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Store(StoreError::ProjectNotFound(_)) => "project_not_found",
            Self::Store(StoreError::Validation(_)) => "validation_error",
            Self::Store(StoreError::UnsupportedSchema { .. }) => "unsupported_schema",
            Self::Store(StoreError::FileSystem(_)) | Self::FileSystem(_) => "filesystem_error",
            Self::Store(_) => "database_error",
            Self::Translation(error) => error.code(),
            Self::Understanding(error) => error.code(),
            Self::Learning(error) => error.code(),
            Self::InvalidTaskKind(_) => "external_task_kind_invalid",
            Self::InvalidTask => "external_task_invalid",
            Self::InvalidResultDirectory(_) => "external_result_directory_invalid",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentResultUpdate {
    pub task_kind: String,
    pub task_id: String,
    pub project_id: String,
    pub status: String,
    pub output_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultAttempt {
    signature: String,
    phase: String,
    message: String,
}

pub fn reconcile_external_agent_results(
    store: &ProjectStore,
) -> Result<Vec<ExternalAgentResultUpdate>, ExternalHandoffError> {
    let mut updates = Vec::new();
    for task in active_manual_tasks(store)? {
        let Some(candidate) = result_candidate(store, &task.id)? else {
            continue;
        };
        let (checking_message, detected_message, changed_message) = match task.kind.as_str() {
            "translation" => (
                "正在检查字幕翻译结果",
                "已检测到外部 Agent 返回，正在检查字幕翻译",
                "检测到返回文件发生变化，正在重新检查字幕翻译",
            ),
            "explanation" => (
                "正在检查场景解释结果",
                "已检测到外部 Agent 返回，正在检查场景解释",
                "检测到返回文件发生变化，正在重新检查场景解释",
            ),
            "learning" => (
                "正在检查词义结果",
                "已检测到外部 Agent 返回，正在检查词义",
                "检测到返回文件发生变化，正在重新检查词义",
            ),
            _ => continue,
        };
        if task.status == "awaiting_external_result" {
            if candidate.was_rejected() {
                continue;
            }
            match task.kind.as_str() {
                "translation" => {
                    translation::set_task_validating(store, &task.id, "awaiting_external_result")?
                }
                "explanation" => {
                    understanding::set_task_validating(store, &task.id, "awaiting_external_result")?
                }
                "learning" => {
                    learning::set_task_validating(store, &task.id, "awaiting_external_result")?
                }
                _ => continue,
            }
            record_attempt(&candidate, "validating", checking_message)?;
            updates.push(validating_update(
                &task.kind,
                &task.id,
                &task.project_id,
                detected_message,
            ));
            continue;
        }
        if !candidate.is_staged() {
            record_attempt(&candidate, "validating", checking_message)?;
            updates.push(validating_update(
                &task.kind,
                &task.id,
                &task.project_id,
                changed_message,
            ));
            continue;
        }
        let result = match task.kind.as_str() {
            "translation" => {
                translation::apply_staged_manual_result(store, &task.id, &candidate.path)
                    .map(|application| application.task.output_version_id)
                    .map_err(|error| error.to_string())
            }
            "explanation" => {
                understanding::apply_staged_manual_result(store, &task.id, &candidate.path)
                    .map(|application| application.task.output_explanation_id)
                    .map_err(|error| error.to_string())
            }
            "learning" => learning::apply_staged_manual_result(store, &task.id, &candidate.path)
                .map(|application| application.task.output_dictionary_entry_id)
                .map_err(|error| error.to_string()),
            _ => continue,
        };
        match result {
            Ok(output_id) => {
                clear_attempt(&candidate.attempt_path);
                let label = match task.kind.as_str() {
                    "translation" => "字幕翻译",
                    "explanation" => "场景解释",
                    "learning" => "词义结果",
                    _ => unreachable!(),
                };
                updates.push(ExternalAgentResultUpdate {
                    task_kind: task.kind,
                    task_id: task.id,
                    project_id: task.project_id,
                    status: "completed".to_owned(),
                    output_id,
                    message: format!("已检测并导入外部 Agent 返回的{label}"),
                });
            }
            Err(message) => updates.push(rejected_update(
                &task.kind,
                &task.id,
                &task.project_id,
                &candidate,
                message,
            )?),
        }
    }
    Ok(updates)
}

struct ActiveManualTask {
    kind: String,
    id: String,
    project_id: String,
    status: String,
}

fn active_manual_tasks(
    store: &ProjectStore,
) -> Result<Vec<ActiveManualTask>, ExternalHandoffError> {
    let connection = store.connect()?;
    let mut statement = connection
        .prepare(
            "SELECT 'translation', id, project_id, status FROM agent_tasks
             WHERE handoff_kind = 'manual'
               AND status IN ('awaiting_external_result', 'validating')
             UNION ALL
             SELECT 'explanation', id, project_id, status FROM explanation_tasks
             WHERE handoff_kind = 'manual'
               AND status IN ('awaiting_external_result', 'validating')
             UNION ALL
             SELECT 'learning', id, project_id, status FROM learning_tasks
             WHERE handoff_kind = 'manual'
               AND status IN ('awaiting_external_result', 'validating')",
        )
        .map_err(StoreError::Database)?;
    statement
        .query_map([], |row| {
            Ok(ActiveManualTask {
                kind: row.get(0)?,
                id: row.get(1)?,
                project_id: row.get(2)?,
                status: row.get(3)?,
            })
        })
        .map_err(StoreError::Database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::Database)
        .map_err(Into::into)
}

pub fn open_external_result_directory(
    store: &ProjectStore,
    task_kind: &str,
    task_id: &str,
) -> Result<bool, ExternalHandoffError> {
    let is_manual = match task_kind {
        "translation" => {
            translation::get_translation_task(store, task_id)?.handoff_kind == "manual"
        }
        "explanation" => {
            understanding::get_explanation_task(store, task_id)?.handoff_kind == "manual"
        }
        "learning" => learning::get_learning_task(store, task_id)?.handoff_kind == "manual",
        value => return Err(ExternalHandoffError::InvalidTaskKind(value.to_owned())),
    };
    if !is_manual {
        return Err(ExternalHandoffError::InvalidTask);
    }
    let directory = result_directory(store, task_id);
    fs::create_dir_all(&directory)?;
    let canonical = dunce::canonicalize(&directory)?;
    let task_root = dunce::canonicalize(store.data_directory().join("agent-tasks"))?;
    if !canonical.starts_with(task_root) || !canonical.is_dir() {
        return Err(ExternalHandoffError::InvalidResultDirectory(
            canonical.display().to_string(),
        ));
    }
    #[cfg(windows)]
    {
        Command::new("explorer.exe").arg(canonical).spawn()?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = canonical;
        Err(ExternalHandoffError::InvalidResultDirectory(
            "当前平台不支持打开返回目录".to_owned(),
        ))
    }
}

struct ResultCandidate {
    path: PathBuf,
    attempt_path: PathBuf,
    signature: String,
    attempt: Option<ResultAttempt>,
}

impl ResultCandidate {
    fn was_rejected(&self) -> bool {
        self.attempt.as_ref().is_some_and(|attempt| {
            attempt.signature == self.signature && attempt.phase == "rejected"
        })
    }

    fn is_staged(&self) -> bool {
        self.attempt.as_ref().is_some_and(|attempt| {
            attempt.signature == self.signature && attempt.phase == "validating"
        })
    }
}

fn result_candidate(
    store: &ProjectStore,
    task_id: &str,
) -> Result<Option<ResultCandidate>, ExternalHandoffError> {
    let directory = result_directory(store, task_id);
    let result_path = directory.join(RESULT_FILE);
    if !result_path.exists() {
        return Ok(None);
    }
    let canonical_directory = dunce::canonicalize(&directory)?;
    let canonical_result = dunce::canonicalize(&result_path)?;
    if !canonical_result.starts_with(&canonical_directory) || !canonical_result.is_file() {
        return Err(ExternalHandoffError::InvalidResultDirectory(
            canonical_result.display().to_string(),
        ));
    }
    let metadata = fs::metadata(&canonical_result)?;
    let signature = if metadata.len() <= MAX_AUTO_HASH_BYTES {
        hash_file(&canonical_result)?
    } else {
        let modified = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("oversize:{}:{modified}", metadata.len())
    };
    let attempt_path = directory.join(ATTEMPT_FILE);
    let attempt = fs::read(&attempt_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ResultAttempt>(&bytes).ok());
    Ok(Some(ResultCandidate {
        path: canonical_result,
        attempt_path,
        signature,
        attempt,
    }))
}

fn validating_update(
    task_kind: &str,
    task_id: &str,
    project_id: &str,
    message: &str,
) -> ExternalAgentResultUpdate {
    ExternalAgentResultUpdate {
        task_kind: task_kind.to_owned(),
        task_id: task_id.to_owned(),
        project_id: project_id.to_owned(),
        status: "validating".to_owned(),
        output_id: None,
        message: message.to_owned(),
    }
}

fn record_attempt(
    candidate: &ResultCandidate,
    phase: &str,
    message: &str,
) -> Result<(), ExternalHandoffError> {
    write_attempt(
        &candidate.attempt_path,
        ResultAttempt {
            signature: candidate.signature.clone(),
            phase: phase.to_owned(),
            message: message.to_owned(),
        },
    )
}

fn rejected_update(
    task_kind: &str,
    task_id: &str,
    project_id: &str,
    candidate: &ResultCandidate,
    message: String,
) -> Result<ExternalAgentResultUpdate, ExternalHandoffError> {
    write_attempt(
        &candidate.attempt_path,
        ResultAttempt {
            signature: candidate.signature.clone(),
            phase: "rejected".to_owned(),
            message: message.clone(),
        },
    )?;
    Ok(ExternalAgentResultUpdate {
        task_kind: task_kind.to_owned(),
        task_id: task_id.to_owned(),
        project_id: project_id.to_owned(),
        status: "rejected".to_owned(),
        output_id: None,
        message,
    })
}

fn write_attempt(path: &Path, attempt: ResultAttempt) -> Result<(), ExternalHandoffError> {
    fs::write(
        path,
        serde_json::to_vec_pretty(&attempt)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?,
    )?;
    Ok(())
}

fn result_directory(store: &ProjectStore, task_id: &str) -> PathBuf {
    store
        .data_directory()
        .join("agent-tasks")
        .join(task_id)
        .join("output")
}

fn clear_attempt(path: &Path) {
    if path.exists() {
        let _ = fs::remove_file(path);
    }
}

fn hash_file(path: &Path) -> Result<String, io::Error> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::{record_attempt, result_candidate};
    use crate::store::ProjectStore;

    #[test]
    fn candidate_retries_only_after_the_result_file_changes() {
        let temporary = TempDir::new().expect("temporary directory should exist");
        let store = ProjectStore::open(
            temporary
                .path()
                .join("app-data")
                .join("projects")
                .join("siaovplay.db"),
        )
        .expect("store should open");
        let task_id = "1bb7ac17-eb44-489e-a7a8-420f75577809";
        let output = store
            .data_directory()
            .join("agent-tasks")
            .join(task_id)
            .join("output");
        fs::create_dir_all(&output).expect("output directory should exist");
        fs::write(output.join("result.json"), b"{\"taskId\":\"first\"}")
            .expect("candidate should be written");

        let first = result_candidate(&store, task_id)
            .expect("candidate should resolve")
            .expect("candidate should exist");
        record_attempt(&first, "validating", "checking").expect("attempt should persist");
        assert!(
            result_candidate(&store, task_id)
                .expect("candidate should resolve")
                .expect("candidate should exist")
                .is_staged()
        );

        record_attempt(&first, "rejected", "invalid").expect("rejection should persist");
        assert!(
            result_candidate(&store, task_id)
                .expect("candidate should resolve")
                .expect("candidate should exist")
                .was_rejected()
        );

        fs::write(output.join("result.json"), b"{\"taskId\":\"second\"}")
            .expect("candidate should change");
        assert!(
            !result_candidate(&store, task_id)
                .expect("candidate should resolve")
                .expect("candidate should exist")
                .was_rejected()
        );
    }
}
