use super::*;
use std::fs::OpenOptions;

pub(super) fn prepare(path: &Path, journal: &Journal) -> Result<(), LocalResourceError> {
    write_initial(path, journal, |file, bytes| file.write_all(bytes))
}
fn write_initial(
    path: &Path,
    journal: &Journal,
    write: impl FnOnce(&mut File, &[u8]) -> io::Result<()>,
) -> Result<(), LocalResourceError> {
    validate(journal)?;
    for existing in [path.to_path_buf(), path.with_extension("json.bak")] {
        match fs::symlink_metadata(existing) {
            Ok(_) => return Err(invalid()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    let mut bytes = serde_json::to_vec_pretty(journal)?;
    bytes.push(b'\n');
    let part = path.with_extension("json.part");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part)?;
    let result = write(&mut file, &bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result.and_then(|()| fs::rename(&part, path)) {
        // Only this create_new call owns the partial file; no payload/configuration was changed.
        if let Err(cleanup) = remove_regular(&part) {
            return Err(io::Error::other(format!(
                "激活日志写入失败且临时记录未能清理，文件已保留：{error}；{cleanup}"
            ))
            .into());
        }
        return Err(error.into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_initial_write_does_not_poison_future_resource_operations() {
        let (_root, manager, journal) = super::super::tests::setup("2");
        let path = journal_path(&manager.config_path).unwrap();
        let config = fs::read(&manager.config_path).unwrap();
        let result = write_initial(&path, &journal, |file, _| {
            file.write_all(b"{")?;
            Err(io::Error::other("injected disk full"))
        });
        assert!(result.is_err());
        assert!(!pending(&manager.config_path).unwrap());
        assert_eq!(fs::read(&manager.config_path).unwrap(), config);
        assert!(!receipt_path(&journal).exists());
        prepare(&path, &journal).unwrap();
        assert_eq!(recover(&manager.config_path).unwrap(), Recovery::RolledBack);
    }
    #[test]
    fn preparation_preserves_existing_records_and_directories() {
        for suffix in ["json", "json.bak", "json.part"] {
            for directory in [false, true] {
                let (_root, manager, journal) = super::super::tests::setup("2");
                let path = journal_path(&manager.config_path).unwrap();
                let existing = path.with_extension(suffix);
                if directory {
                    fs::create_dir(&existing).unwrap();
                } else {
                    fs::write(&existing, b"retained").unwrap();
                }
                assert!(prepare(&path, &journal).is_err());
                if directory {
                    assert!(existing.is_dir());
                } else {
                    assert_eq!(fs::read(&existing).unwrap(), b"retained");
                }
            }
        }
    }
}
