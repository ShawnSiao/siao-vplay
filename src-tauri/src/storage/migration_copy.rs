use std::{
    ffi::OsString,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use super::{StorageError, migration_stream, migration_receipt::VerifiedFile};

#[derive(Clone, Debug)]
pub(crate) struct CopyEntry {
    pub source: PathBuf,
    pub relative: PathBuf,
    pub bytes: u64,
}

#[cfg(test)]
pub(crate) fn scan_files(
    source: &Path,
    skip_database: Option<&Path>,
) -> Result<Vec<CopyEntry>, StorageError> {
    scan_files_controlled(source, skip_database, &AtomicBool::new(false))
}

#[cfg(test)]
pub(crate) fn scan_files_controlled(
    source: &Path,
    skip_database: Option<&Path>,
    cancelled: &AtomicBool,
) -> Result<Vec<CopyEntry>, StorageError> {
    scan_files_excluding(source, skip_database, cancelled, &[])
}

pub(super) fn scan_files_excluding(
    source: &Path,
    skip_database: Option<&Path>,
    cancelled: &AtomicBool,
    excluded_top_level: &[&str],
) -> Result<Vec<CopyEntry>, StorageError> {
    migration_stream::check(cancelled)?;
    let mut files = Vec::new();
    if !source.exists() {
        return Ok(files);
    }
    let mut pending = vec![source.to_path_buf()];
    while let Some(directory) = pending.pop() {
        migration_stream::check(cancelled)?;
        for entry in fs::read_dir(&directory)? {
            migration_stream::check(cancelled)?;
            let entry = entry?;
            if directory == source && entry.file_name() == crate::instance_lock::LOCK_FILE_NAME {
                continue;
            }
            if directory == source && entry.file_name().to_str().is_some_and(|name|
                excluded_top_level.iter().any(|excluded| name.eq_ignore_ascii_case(excluded))) {
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
    migration_stream::check(cancelled)?;
    Ok(files)
}

pub(super) fn copy_and_verify<F>(
    entries: &[CopyEntry],
    destination: &Path,
    cancelled: &AtomicBool,
    mut progress: F,
) -> Result<Vec<VerifiedFile>, StorageError>
where
    F: FnMut(u64, usize) -> Result<(), StorageError>,
{
    let mut copied_bytes = 0_u64;
    let mut verified = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) {
            return Err(StorageError::MigrationCancelled);
        }
        let target = destination.join(&entry.relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        copy_file(&entry.source, &target, cancelled)?;
        let hash = file_sha256(&target, cancelled)?;
        if file_sha256(&entry.source, cancelled)? != hash {
            return Err(StorageError::MigrationIntegrity(format!(
                "文件校验失败：{}",
                entry.relative.display()
            )));
        }
        let file = VerifiedFile::copied(&entry.relative, &target, hash)?;
        copied_bytes = copied_bytes.saturating_add(file.bytes);
        verified.push(file);
        migration_stream::check(cancelled)?;
        progress(copied_bytes, index + 1)?;
    }
    migration_stream::check(cancelled)?;
    Ok(verified)
}

fn copy_file(
    source: &Path,
    destination: &Path,
    cancelled: &AtomicBool,
) -> Result<(), StorageError> {
    migration_stream::check(cancelled)?;
    let mut reader = fs::File::open(source)?;
    copy_reader(&mut reader, destination, cancelled)
}

fn copy_reader(
    reader: &mut impl Read,
    destination: &Path,
    cancelled: &AtomicBool,
) -> Result<(), StorageError> {
    migration_stream::check(cancelled)?;
    let temporary = destination.with_file_name(format!(
        ".siaovplay-migration-{}.part",
        uuid::Uuid::new_v4().simple()
    ));
    let mut writer = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let result = (|| -> Result<(), StorageError> {
        migration_stream::copy_bytes(reader, &mut writer, cancelled)?;
        migration_stream::check(cancelled)?;
        writer.flush()?;
        writer.sync_all()?;
        drop(writer);
        migration_stream::check(cancelled)?;
        // Replace only after the copy is durable; do not delete an old destination first.
        fs::rename(&temporary, destination)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(super) fn file_sha256(path: &Path, cancelled: &AtomicBool) -> Result<String, StorageError> {
    migration_stream::check(cancelled)?;
    migration_stream::hash_bytes(&mut fs::File::open(path)?, cancelled)
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
    fn mid_copy_cancellation_keeps_prior_target_and_removes_own_temporary_file() {
        struct Reader<'a>(&'a AtomicBool);
        impl Read for Reader<'_> {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                buffer.fill(1);
                self.0.store(true, Ordering::Relaxed);
                Ok(buffer.len())
            }
        }
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target.txt");
        fs::write(&target, b"retain").unwrap();
        let cancelled = AtomicBool::new(false);
        assert!(matches!(
            copy_reader(&mut Reader(&cancelled), &target, &cancelled),
            Err(StorageError::MigrationCancelled)
        ));
        assert_eq!(fs::read(&target).unwrap(), b"retain");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn cancelled_scan_and_hash_do_not_open_the_source() {
        let directory = tempfile::tempdir().unwrap();
        let absent = directory.path().join("absent");
        let cancelled = AtomicBool::new(true);
        assert!(matches!(
            scan_files_controlled(&absent, None, &cancelled),
            Err(StorageError::MigrationCancelled)
        ));
        assert!(matches!(
            file_sha256(&absent, &cancelled),
            Err(StorageError::MigrationCancelled)
        ));
    }

    #[test]
    fn cancellation_at_final_progress_is_not_reported_as_success() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("file"), b"source").unwrap();
        let entries = scan_files(&source, None).unwrap();
        let cancelled = AtomicBool::new(false);
        let result = copy_and_verify(
            &entries,
            &directory.path().join("destination"),
            &cancelled,
            |_, _| {
                cancelled.store(true, Ordering::Relaxed);
                Ok(())
            },
        );
        assert!(matches!(result, Err(StorageError::MigrationCancelled)));
        assert_eq!(fs::read(source.join("file")).unwrap(), b"source");
    }

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
    fn temporary_suffix_is_a_valid_user_filename() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        let destination = directory.path().join("destination");
        fs::create_dir_all(&source).unwrap();
        for (name, content) in [
            ("asset.siaovplay-migration-part", "first"),
            ("asset.txt", "second"),
        ] {
            fs::write(source.join(name), content).unwrap();
        }
        let entries = scan_files(&source, None).unwrap();
        copy_and_verify(&entries, &destination, &AtomicBool::new(false), |_, _| {
            Ok(())
        })
        .unwrap();
        for (name, content) in [
            ("asset.siaovplay-migration-part", "first"),
            ("asset.txt", "second"),
        ] {
            assert_eq!(fs::read_to_string(source.join(name)).unwrap(), content);
            assert_eq!(fs::read_to_string(destination.join(name)).unwrap(), content);
        }
        assert_eq!(fs::read_dir(destination).unwrap().count(), 2);
    }

    #[test]
    fn failed_publication_cleans_only_its_own_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.txt");
        let target = directory.path().join("destination");
        fs::write(&source, "source").unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(target.join("retained.txt"), "retained").unwrap();
        let unrelated = directory
            .path()
            .join("destination.siaovplay-migration-part");
        fs::write(&unrelated, "unrelated").unwrap();
        assert!(copy_file(&source, &target, &AtomicBool::new(false)).is_err());
        assert_eq!(fs::read_to_string(&source).unwrap(), "source");
        assert_eq!(
            fs::read_to_string(target.join("retained.txt")).unwrap(),
            "retained"
        );
        assert_eq!(fs::read_to_string(unrelated).unwrap(), "unrelated");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 3);
    }

    #[test]
    fn retry_replaces_an_existing_destination() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.txt");
        let target = directory.path().join("destination.txt");
        fs::write(&source, "new").unwrap();
        fs::write(&target, "old").unwrap();
        copy_file(&source, &target, &AtomicBool::new(false)).unwrap();
        assert_eq!(fs::read_to_string(target).unwrap(), "new");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
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

#[cfg(all(test, windows))]
#[path = "migration_link_tests.rs"]
mod link_tests;
