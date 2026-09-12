use std::{fs, io::Write, path::{Path, PathBuf}};
use super::{StorageError, model::{StorageSettingsFile, settings_version}};

pub(super) const SETTINGS_FILE_NAME: &str = "storage-settings.json";

fn ordinary_file(path: &Path) -> Result<bool, StorageError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(true),
        Ok(_) => Err(StorageError::InvalidPath("存储配置路径不是普通文件，未修改原有内容".to_owned())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn load_settings(path: &Path) -> Result<StorageSettingsFile, StorageError> {
    if ordinary_file(path)? {
        return Ok(serde_json::from_slice(&fs::read(path)?)?);
    }
    let parent = path.parent().ok_or_else(|| StorageError::InvalidPath("配置目录缺失".to_owned()))?;
    let prefix = format!(".{SETTINGS_FILE_NAME}.");
    let mut previous: Option<PathBuf> = None;
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        let Some(id) = name.strip_prefix(&prefix).and_then(|name| name.strip_suffix(".previous")) else { continue; };
        if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) { continue; }
        if previous.is_some() {
            return Err(StorageError::InvalidPath("发现多份中断的存储配置备份，无法确定恢复来源；已保留文件，请先检查配置目录".to_owned()));
        }
        ordinary_file(&entry.path())?;
        previous = Some(entry.path());
    }
    let Some(previous) = previous else { return Ok(StorageSettingsFile::default()); };
    let settings: StorageSettingsFile = serde_json::from_slice(&fs::read(&previous)?)?;
    if !matches!(settings.version, 1 | 2) && settings.version != settings_version() { return Err(StorageError::UnsupportedVersion(settings.version)); }
    // Restore the committed legacy backup, never an unfinished .part candidate.
    // Keep legacy files for inspection; startup holds the bootstrap-directory owner lock.
    persist_settings(path, &settings)?;
    Ok(settings)
}

pub(crate) fn persist_settings(path: &Path, settings: &StorageSettingsFile) -> Result<(), StorageError> {
    ordinary_file(path)?;
    let temporary = path.with_file_name(format!(".{SETTINGS_FILE_NAME}.{}.part", uuid::Uuid::new_v4().simple()));
    let bytes = serde_json::to_vec_pretty(settings)?;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    let result: Result<(), StorageError> = (|| {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        // Same-directory replacement keeps the old file in place until the rename succeeds.
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}
