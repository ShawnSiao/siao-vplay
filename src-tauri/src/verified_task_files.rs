use crate::{
    agent_task_files::{TaskFile, hash_bytes},
    store::{ProjectStore, StoreError},
};
use std::{
    fs,
    io::Read,
    path::{Component, Path},
};

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDomain {
    Explanation,
    Learning,
}
impl TaskDomain {
    pub(crate) fn table(self) -> &'static str {
        match self {
            Self::Explanation => "explanation_tasks",
            Self::Learning => "learning_tasks",
        }
    }
}

pub(crate) fn read_for_task(
    store: &ProjectStore,
    domain: TaskDomain,
    task_id: &str,
    relative: &str,
) -> Result<Vec<u8>, StoreError> {
    uuid::Uuid::parse_str(task_id).map_err(|_| invalid("任务身份无效"))?;
    let hash: String = store.connect()?.query_row(
        &format!(
            "SELECT material_manifest_sha256 FROM {} WHERE id = ?1",
            domain.table()
        ),
        [task_id],
        |row| row.get(0),
    )?;
    read(
        &store.data_directory().join("agent-tasks").join(task_id),
        &hash,
        relative,
    )
}

pub(crate) fn read_text(
    store: &ProjectStore,
    domain: TaskDomain,
    task_id: &str,
    relative: &str,
) -> Result<String, StoreError> {
    String::from_utf8(read_for_task(store, domain, task_id, relative)?)
        .map_err(|_| invalid("任务材料不是有效 UTF-8 文本"))
}

pub(crate) fn explanation_frame(
    store: &ProjectStore,
    task_id: &str,
    frame: &crate::understanding::ExplanationFrame,
) -> Result<Vec<u8>, StoreError> {
    let ordinal = frame
        .ordinal
        .checked_add(1)
        .ok_or_else(|| invalid("关键帧编号无效"))?;
    let bytes = read_for_task(
        store,
        TaskDomain::Explanation,
        task_id,
        &format!("input/frames/frame-{ordinal:04}.jpg"),
    )?;
    if !hash_bytes(&bytes).eq_ignore_ascii_case(&frame.sha256) {
        return Err(invalid("关键帧与任务记录不一致"));
    }
    Ok(bytes)
}

const MAXIMUM_BYTES: u64 = 32 * 1024 * 1024;

// Return the bytes that were hashed, rather than reopening a path after validation.
pub(crate) fn read(
    directory: &Path,
    expected_manifest: &str,
    relative: &str,
) -> Result<Vec<u8>, StoreError> {
    let directory = dunce::canonicalize(directory)?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&bounded(&directory.join("task.json"))?)
            .map_err(|_| invalid("任务材料清单无效"))?;
    let files: Vec<TaskFile> =
        serde_json::from_value(manifest.get("files").cloned().unwrap_or_default())
            .map_err(|_| invalid("任务材料清单缺失"))?;
    let canonical = serde_json::to_vec(&files).map_err(|_| invalid("任务材料清单无效"))?;
    if !hash_bytes(&canonical).eq_ignore_ascii_case(expected_manifest) {
        return Err(invalid("任务材料清单已改变"));
    }
    let matching = files
        .iter()
        .filter(|file| file.path == relative)
        .collect::<Vec<_>>();
    if matching.len() != 1 {
        return Err(invalid("任务文件不在已确认材料中"));
    }
    let path = Path::new(relative);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(invalid("任务材料路径超出受控目录"));
    }
    let path = dunce::canonicalize(directory.join(path))?;
    if !path.starts_with(&directory) {
        return Err(invalid("任务材料路径超出受控目录"));
    }
    let bytes = bounded(&path)?;
    if !hash_bytes(&bytes).eq_ignore_ascii_case(&matching[0].sha256) {
        return Err(invalid("任务材料内容已改变"));
    }
    Ok(bytes)
}

fn bounded(path: &Path) -> Result<Vec<u8>, StoreError> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(MAXIMUM_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAXIMUM_BYTES {
        return Err(invalid("任务材料超过读取上限"));
    }
    Ok(bytes)
}
fn invalid(message: &str) -> StoreError {
    StoreError::Validation(message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(directory: &Path, path: &str, bytes: &[u8]) -> String {
        let files = vec![TaskFile {
            path: path.into(),
            sha256: hash_bytes(bytes),
            content_type: "text/plain".into(),
            purpose: "fixture".into(),
        }];
        let hash = hash_bytes(&serde_json::to_vec(&files).unwrap());
        fs::write(
            directory.join("task.json"),
            serde_json::to_vec(&serde_json::json!({ "files": files })).unwrap(),
        )
        .unwrap();
        hash
    }
    #[test]
    fn retains_authorized_bytes_and_rejects_replaced_content() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("prompt.md"), b"authorized").unwrap();
        let hash = fixture(directory.path(), "prompt.md", b"authorized");
        let bytes = read(directory.path(), &hash, "prompt.md").unwrap();
        fs::write(directory.path().join("prompt.md"), b"replaced").unwrap();
        assert_eq!(bytes, b"authorized");
        assert!(read(directory.path(), &hash, "prompt.md").is_err());
    }
    #[test]
    fn rejects_a_self_consistent_manifest_that_is_not_the_stored_manifest() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("prompt.md"), b"authorized").unwrap();
        let hash = fixture(directory.path(), "prompt.md", b"authorized");
        fs::write(directory.path().join("prompt.md"), b"replaced").unwrap();
        fixture(directory.path(), "prompt.md", b"replaced");
        assert!(read(directory.path(), &hash, "prompt.md").is_err());
    }
    #[test]
    fn rejects_even_manifest_listed_files_outside_the_task_directory() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("task");
        fs::create_dir_all(&root).unwrap();
        fs::write(directory.path().join("outside.txt"), b"fixture").unwrap();
        let hash = fixture(&root, "../outside.txt", b"fixture");
        assert!(read(&root, &hash, "../outside.txt").is_err());
    }
}
