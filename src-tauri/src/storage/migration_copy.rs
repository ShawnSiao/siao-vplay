use std::{
    ffi::OsString,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use sha2::{Digest, Sha256};

use super::StorageError;

#[derive(Clone, Debug)]
pub(crate) struct CopyEntry {
    pub source: PathBuf,
    pub relative: PathBuf,
    pub bytes: u64,
}

pub(crate) fn scan_files(
    source: &Path,
    skip_database: Option<&Path>,
) -> Result<Vec<CopyEntry>, StorageError> {
    let mut files = Vec::new();
    if !source.exists() {
        return Ok(files);
    }
    let mut pending = vec![source.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            if directory == source && entry.file_name() == crate::instance_lock::LOCK_FILE_NAME {
                continue;
            }
            let metadata = entry.metadata()?;
            if metadata.is_symlink() {
                return Err(StorageError::MigrationIntegrity(format!(
                    "迁移来源包含不支持的符号链接：{}",
                    entry.path().display()
                )));
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() && !is_database_companion(&entry.path(), skip_database) {
                files.push(CopyEntry {
                    relative: entry
                        .path()
                        .strip_prefix(source)
                        .map_err(|_| StorageError::MigrationIntegrity("来源路径越界".to_owned()))?
                        .to_path_buf(),
                    source: entry.path(),
                    bytes: metadata.len(),
                });
            }
        }
    }
    files.sort_by(|left, right| left.relative.cmp(&right.relative));
    Ok(files)
}

pub(crate) fn copy_and_verify<F>(
    entries: &[CopyEntry],
    destination: &Path,
    cancelled: &AtomicBool,
    mut progress: F,
) -> Result<(), StorageError>
where
    F: FnMut(u64, usize) -> Result<(), StorageError>,
{
    let mut copied_bytes = 0_u64;
    for (index, entry) in entries.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) {
            return Err(StorageError::MigrationCancelled);
        }
        let target = destination.join(&entry.relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        copy_file(&entry.source, &target)?;
        if file_sha256(&entry.source)? != file_sha256(&target)? {
            return Err(StorageError::MigrationIntegrity(format!(
                "文件校验失败：{}",
                entry.relative.display()
            )));
        }
        copied_bytes = copied_bytes.saturating_add(entry.bytes);
        progress(copied_bytes, index + 1)?;
    }
    Ok(())
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), StorageError> {
    let temporary = destination.with_extension("siaovplay-migration-part");
    if temporary.exists() {
        fs::remove_file(&temporary)?;
    }
    let mut reader = fs::File::open(source)?;
    let mut writer = fs::File::create(&temporary)?;
    std::io::copy(&mut reader, &mut writer)?;
    writer.flush()?;
    writer.sync_all()?;
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(temporary, destination)?;
    Ok(())
}

fn file_sha256(path: &Path) -> Result<String, StorageError> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn is_database_companion(path: &Path, database: Option<&Path>) -> bool {
    let Some(database) = database else {
        return false;
    };
    if path == database {
        return true;
    }
    if path.parent() != database.parent() {
        return false;
    }
    ["-wal", "-shm"].iter().any(|suffix| {
        let mut companion = OsString::from(database.file_name().unwrap_or_default());
        companion.push(suffix);
        path.file_name().is_some_and(|name| name == companion)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_verifies_nested_files_and_skips_database_companions() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        let destination = directory.path().join("destination");
        let database = source.join("projects/siaovplay.db");
        fs::create_dir_all(database.parent().unwrap()).unwrap();
        fs::write(source.join("projects/file.txt"), b"content").unwrap();
        fs::write(&database, b"database").unwrap();
        fs::write(format!("{}-wal", database.display()), b"wal").unwrap();
        let entries = scan_files(&source, Some(&database)).unwrap();
        assert_eq!(
            entries.len(),
            1,
            "unexpected entries: {:?}",
            entries
                .iter()
                .map(|entry| &entry.relative)
                .collect::<Vec<_>>()
        );
        copy_and_verify(&entries, &destination, &AtomicBool::new(false), |_, _| {
            Ok(())
        })
        .unwrap();
        assert_eq!(
            fs::read(destination.join("projects/file.txt")).unwrap(),
            b"content"
        );
    }

    #[test]
    fn cancellation_leaves_source_file_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        let destination = directory.path().join("destination");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("source.mp4"), b"source").unwrap();
        let entries = scan_files(&source, None).unwrap();
        let error = copy_and_verify(
            &entries,
            &destination,
            &AtomicBool::new(true),
            |_, _| Ok(()),
        )
        .unwrap_err();
        assert!(matches!(error, StorageError::MigrationCancelled));
        assert_eq!(fs::read(source.join("source.mp4")).unwrap(), b"source");
    }
}
