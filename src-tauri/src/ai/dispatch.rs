use super::{
    AiError, config,
    task_types::AiTaskError,
    types::{AiExecutionTarget, AiMaterialAuthorization, AiTaskExecutionInfo},
};
use crate::{
    agent_task_files::hash_bytes,
    learning,
    store::ProjectStore,
    understanding,
    verified_task_files::{self, TaskDomain},
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTaskDispatchInput {
    pub task_id: String,
    pub task_kind: TaskDomain,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchSubtitle {
    pub version_id: String,
    pub version_number: i64,
    pub role: String,
    pub language: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchFrame {
    pub id: String,
    pub timestamp_ms: i64,
    pub sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchPrompt {
    pub template: String,
    pub requirements: String,
    pub one_time_requirements: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDispatchPreview {
    pub task_id: String,
    pub task_kind: TaskDomain,
    pub confirmation_sha256: String,
    pub execution: AiExecutionTarget,
    pub authorization: AiMaterialAuthorization,
    pub receiver: String,
    pub endpoint: Option<String>,
    pub model: String,
    pub subtitles: Vec<DispatchSubtitle>,
    pub subtitle_count: usize,
    pub playback_cutoff_ms: i64,
    pub selected_text: Option<String>,
    pub prompt: Option<DispatchPrompt>,
    pub frames: Vec<DispatchFrame>,
}

pub(crate) fn preview(
    store: &ProjectStore,
    kind: TaskDomain,
    id: &str,
) -> Result<TaskDispatchPreview, AiTaskError> {
    let (
        project,
        execution,
        source,
        translation,
        count,
        cutoff,
        selected,
        frames,
        task_value,
        prompt,
        schema,
    ) = match kind {
        TaskDomain::Explanation => {
            let task = understanding::get_explanation_task(store, id)?;
            let prompt = understanding::read_explanation_prompt(store, id)?;
            let schema = understanding::read_explanation_schema(store, id)?;
            let mut frames = Vec::new();
            for frame in &task.frames {
                verified_task_files::explanation_frame(store, id, frame)?;
                frames.push(DispatchFrame {
                    id: frame.id.clone(),
                    timestamp_ms: frame.timestamp_ms,
                    sha256: frame.sha256.clone(),
                });
            }
            let value = serde_json::to_value(&task)?;
            (
                task.project_id,
                task.execution,
                task.source_version_id,
                task.translation_version_id,
                task.authorized_segment_ids.len(),
                task.playback_cutoff_ms,
                None,
                frames,
                value,
                prompt,
                schema,
            )
        }
        TaskDomain::Learning => {
            let task = learning::get_learning_task(store, id)?;
            let prompt = learning::read_learning_prompt(store, id)?;
            let schema = learning::read_learning_schema(store, id)?;
            let value = serde_json::to_value(&task)?;
            (
                task.project_id,
                task.execution,
                task.source_version_id,
                task.translation_version_id,
                1,
                task.playback_position_ms,
                Some(task.selected_text),
                Vec::new(),
                value,
                prompt,
                schema,
            )
        }
    };
    let (target, receiver, endpoint, model) = receiver(&execution)?;
    let connection = store.connect()?;
    let mut subtitles = Vec::new();
    for id in std::iter::once(source).chain(translation) {
        subtitles.push(connection.query_row(
            "SELECT v.id, v.version_number, t.role, v.language_code FROM subtitle_versions v
             JOIN subtitle_tracks t ON t.id = v.track_id WHERE v.id = ?1 AND v.project_id = ?2",
            rusqlite::params![id, project],
            |row| {
                Ok(DispatchSubtitle {
                    version_id: row.get(0)?,
                    version_number: row.get(1)?,
                    role: row.get(2)?,
                    language: row.get(3)?,
                })
            },
        )?);
    }
    let prompt_details = if kind == TaskDomain::Explanation {
        let snapshot: crate::summary::PromptSnapshot = serde_json::from_slice(
            &verified_task_files::read_for_task(store, kind, id, "input/prompt-snapshot.json")?,
        )?;
        Some(DispatchPrompt {
            template: snapshot.template_name,
            requirements: snapshot.template_requirements,
            one_time_requirements: snapshot.one_time_requirements,
        })
    } else {
        None
    };
    let mut value = TaskDispatchPreview {
        task_id: id.to_owned(),
        task_kind: kind,
        confirmation_sha256: String::new(),
        execution: target,
        authorization: AiMaterialAuthorization {
            subtitles: true,
            current_question: true,
            frames: !frames.is_empty(),
            service_revision: execution.service_revision,
        },
        receiver,
        endpoint,
        model,
        subtitles,
        subtitle_count: count,
        playback_cutoff_ms: cutoff,
        selected_text: selected,
        prompt: prompt_details,
        frames,
    };
    value.confirmation_sha256 = hash_bytes(&serde_json::to_vec(&serde_json::json!({
        "protocol": "siaovplay-ai-dispatch-v1", "preview": &value, "task": task_value,
        "promptSha256": hash_bytes(prompt.as_bytes()), "schema": schema,
    }))?);
    Ok(value)
}

pub(crate) fn verify(
    store: &ProjectStore,
    kind: TaskDomain,
    id: &str,
    hash: &str,
) -> Result<TaskDispatchPreview, AiTaskError> {
    let value = preview(store, kind, id)?;
    if hash.len() != 64 || value.confirmation_sha256 != hash {
        return Err(invalid("接收方或材料已经改变，请重新查看并确认发送清单"));
    }
    Ok(value)
}

pub(crate) fn verify_choice(
    store: &ProjectStore,
    kind: TaskDomain,
    input: &super::task_types::ResumeAiTaskInput,
) -> Result<(), AiTaskError> {
    let value = verify(store, kind, &input.task_id, &input.confirmation_sha256)?;
    if value.execution != input.execution || value.authorization != input.authorization {
        return Err(invalid("执行方式与已确认任务不一致，请重新准备材料"));
    }
    Ok(())
}

pub(crate) fn verify_codex(
    store: &ProjectStore,
    kind: TaskDomain,
    id: &str,
    hash: &str,
) -> Result<(), crate::commands::CommandError> {
    let value = verify(store, kind, id, hash).map_err(|error| crate::commands::CommandError {
        code: "dispatch_confirmation_required",
        message: error.to_string(),
    })?;
    if value.execution != AiExecutionTarget::Codex {
        return Err(crate::commands::CommandError {
            code: "dispatch_receiver_changed",
            message: "任务接收方不是 Codex，请重新确认处理方式".to_owned(),
        });
    }
    Ok(())
}

fn receiver(
    execution: &AiTaskExecutionInfo,
) -> Result<(AiExecutionTarget, String, Option<String>, String), AiTaskError> {
    match execution.kind.as_str() {
        "manual" => Ok((
            AiExecutionTarget::Manual,
            "自行选择的工具".into(),
            None,
            "由所选工具决定".into(),
        )),
        "codex" => Ok((
            AiExecutionTarget::Codex,
            "OpenAI（经本机 Codex）".into(),
            None,
            "Codex 默认模型".into(),
        )),
        "api" => {
            let id = execution
                .service_config_id
                .as_deref()
                .ok_or_else(|| invalid("任务缺少接收服务，请重新准备"))?;
            let service = config::store()?.configured_service(id)?;
            if execution.service_revision != Some(service.revision) {
                return Err(AiError::RevisionConflict.into());
            }
            let model = execution
                .model_id
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| invalid("任务缺少模型，请重新准备"))?;
            Ok((
                AiExecutionTarget::Api {
                    service_config_id: id.to_owned(),
                    model_id: model.clone(),
                },
                service.display_name,
                Some(service.base_url),
                model,
            ))
        }
        _ => Err(invalid("任务执行方式无效，请重新准备")),
    }
}
fn invalid(message: &str) -> AiTaskError {
    AiError::Validation(message.to_owned()).into()
}
