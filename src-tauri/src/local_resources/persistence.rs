use super::{LocalResourceConfiguration, LocalResourceError, validate_configuration};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    fs::{self, File},
    io::{self, Write},
    path::Path,
};

// Called during single-instance startup before resource tasks begin.
pub(super) fn load_configuration(
    path: &Path,
) -> Result<Option<LocalResourceConfiguration>, LocalResourceError> {
    read_recovering(path, validate_configuration)
}
pub(super) fn read_recovering<T: DeserializeOwned>(
    path: &Path,
    validate: impl Fn(&T) -> Result<(), LocalResourceError>,
) -> Result<Option<T>, LocalResourceError> {
    if let Some(value) = read_candidate(path, &validate)? {
        return Ok(Some(value));
    }
    for candidate in [
        path.with_extension("json.bak"),
        path.with_extension("json.part"),
    ] {
        if let Some(value) = read_candidate(&candidate, &validate)? {
            fs::rename(&candidate, path)?;
            return Ok(Some(value));
        }
    }
    Ok(None)
}
pub(super) fn read_candidate<T: DeserializeOwned>(
    path: &Path,
    validate: &impl Fn(&T) -> Result<(), LocalResourceError>,
) -> Result<Option<T>, LocalResourceError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "资源记录或恢复副本不是普通文件，请检查配置目录",
        )
        .into());
    }
    let value = serde_json::from_slice(&fs::read(path)?)?;
    validate(&value)?;
    Ok(Some(value))
}

pub(super) fn persist_json(path: &Path, value: &impl Serialize) -> Result<(), LocalResourceError> {
    write(path, value, |backup| fs::remove_file(backup))
}
fn write(
    path: &Path,
    value: &impl Serialize,
    cleanup: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<(), LocalResourceError> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    write_bytes(path, &bytes, cleanup)
}
pub(super) fn persist_raw_json(path: &Path, value: &str) -> Result<(), LocalResourceError> {
    serde_json::from_str::<serde_json::Value>(value)?;
    write_bytes(path, value.as_bytes(), |backup| fs::remove_file(backup))
}
fn write_bytes(
    path: &Path,
    bytes: &[u8],
    cleanup: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<(), LocalResourceError> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("配置路径没有父目录"))?;
    fs::create_dir_all(parent)?;
    let part_path = path.with_extension("json.part");
    let backup_path = path.with_extension("json.bak");
    let mut file = File::create(&part_path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    if path.exists() {
        if backup_path.exists() {
            fs::remove_file(&backup_path)?;
        }
        fs::rename(path, &backup_path)?;
    }
    if let Err(error) = fs::rename(&part_path, path) {
        if backup_path.exists() {
            let _ = fs::rename(&backup_path, path);
        }
        return Err(error.into());
    }
    // The rename committed the new value. A retained backup is housekeeping, not a failed save.
    if backup_path.exists() {
        let _ = cleanup(&backup_path);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_cleanup_failure_does_not_report_committed_settings_as_unsaved() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("settings.json");
        persist_json(&path, &"old").unwrap();
        let result = write(&path, &"new", |_| {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "busy backup",
            ))
        });
        assert!(result.is_ok(), "new settings already committed");
        assert_eq!(
            serde_json::from_slice::<String>(&fs::read(&path).unwrap()).unwrap(),
            "new"
        );
        assert_eq!(
            serde_json::from_slice::<String>(&fs::read(path.with_extension("json.bak")).unwrap())
                .unwrap(),
            "old"
        );
        persist_json(&path, &"later").unwrap();
        assert!(!path.with_extension("json.bak").exists());
    }
}

// Call only while holding the manager write lock. Keep the primary until every
// recovery copy has been removed, so interruption cannot resurrect a deletion.
pub(super) fn remove_record(path: &Path) -> Result<bool, LocalResourceError> {
    let candidates = [
        path.with_extension("json.part"),
        path.with_extension("json.bak"),
        path.to_path_buf(),
    ];
    let mut existing = Vec::new();
    for candidate in candidates {
        match fs::symlink_metadata(&candidate) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
            Ok(metadata) if metadata.file_type().is_file() => existing.push(candidate),
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "资源记录或恢复副本不是普通文件，已停止删除",
                )
                .into());
            }
        }
    }
    let removed = !existing.is_empty();
    for candidate in existing {
        fs::remove_file(candidate)?;
    }
    Ok(removed)
}
