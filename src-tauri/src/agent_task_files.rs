use std::{fs, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TaskFileError {
    #[error(transparent)]
    FileSystem(#[from] std::io::Error),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    #[error("任务文件超过大小上限")]
    TooLarge,
    #[error("任务文件不是 UTF-8 文本")]
    UnsupportedEncoding,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFile {
    pub path: String,
    pub sha256: String,
    pub content_type: String,
    pub purpose: String,
}

pub fn write_json_file(
    root: &Path,
    relative_path: &str,
    value: &Value,
    purpose: &str,
) -> Result<TaskFile, TaskFileError> {
    let bytes = serde_json::to_vec_pretty(value)?;
    write_package_file(root, relative_path, &bytes, "application/json", purpose)
}

pub fn write_text_file(
    root: &Path,
    relative_path: &str,
    value: &str,
    purpose: &str,
) -> Result<TaskFile, TaskFileError> {
    write_package_file(
        root,
        relative_path,
        value.as_bytes(),
        "text/markdown; charset=utf-8",
        purpose,
    )
}

fn write_package_file(
    root: &Path,
    relative_path: &str,
    bytes: &[u8],
    content_type: &str,
    purpose: &str,
) -> Result<TaskFile, TaskFileError> {
    let path = root.join(relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)?;
    Ok(TaskFile {
        path: relative_path.replace('\\', "/"),
        sha256: hash_bytes(bytes),
        content_type: content_type.to_owned(),
        purpose: purpose.to_owned(),
    })
}

pub fn hash_file(path: &Path) -> Result<String, std::io::Error> {
    Ok(hash_bytes(&fs::read(path)?))
}

pub fn read_small_utf8(path: &Path, maximum_bytes: u64) -> Result<String, TaskFileError> {
    if fs::metadata(path)?.len() > maximum_bytes {
        return Err(TaskFileError::TooLarge);
    }
    String::from_utf8(fs::read(path)?).map_err(|_| TaskFileError::UnsupportedEncoding)
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
