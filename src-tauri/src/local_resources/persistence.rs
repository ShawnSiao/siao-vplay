use super::LocalResourceError;
use serde::Serialize;
use std::{fs::{self, File}, io::{self, Write}, path::Path};

pub(super) fn persist_json(path: &Path, value: &impl Serialize) -> Result<(), LocalResourceError> {
    write(path, value, |backup| fs::remove_file(backup))
}
fn write(path: &Path, value: &impl Serialize, cleanup: impl FnOnce(&Path) -> io::Result<()>) -> Result<(), LocalResourceError> {
    let parent = path.parent().ok_or_else(|| io::Error::other("配置路径没有父目录"))?;
    fs::create_dir_all(parent)?;
    let part_path = path.with_extension("json.part");
    let backup_path = path.with_extension("json.bak");
    let mut file = File::create(&part_path)?;
    serde_json::to_writer_pretty(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    if path.exists() {
        if backup_path.exists() { fs::remove_file(&backup_path)?; }
        fs::rename(path, &backup_path)?;
    }
    if let Err(error) = fs::rename(&part_path, path) {
        if backup_path.exists() { let _ = fs::rename(&backup_path, path); }
        return Err(error.into());
    }
    // The rename committed the new value. A retained backup is housekeeping, not a failed save.
    if backup_path.exists() { let _ = cleanup(&backup_path); }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_cleanup_failure_does_not_report_committed_settings_as_unsaved() {
        let root = tempfile::tempdir().unwrap(); let path = root.path().join("settings.json");
        persist_json(&path, &"old").unwrap();
        let result = write(&path, &"new", |_| Err(io::Error::new(io::ErrorKind::PermissionDenied, "busy backup")));
        assert!(result.is_ok(), "new settings already committed");
        assert_eq!(serde_json::from_slice::<String>(&fs::read(&path).unwrap()).unwrap(), "new");
        assert_eq!(serde_json::from_slice::<String>(&fs::read(path.with_extension("json.bak")).unwrap()).unwrap(), "old");
        persist_json(&path, &"later").unwrap();
        assert!(!path.with_extension("json.bak").exists());
    }
}
