use super::{ReceiptFile, ResourceMigrationError, move_control};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

pub(super) fn validate_destination(
    source: &Path,
    parent: &Path,
) -> Result<(), ResourceMigrationError> {
    let source = dunce::canonicalize(source)?;
    let parent = dunce::canonicalize(parent)?;
    if parent
        .ancestors()
        .any(|path| super::paths_equal(path, &source))
    {
        return Err(ResourceMigrationError::InvalidSource(
            "新保存位置不能位于当前资源目录内部，请选择其他目录".into(),
        ));
    }
    Ok(())
}

pub(super) fn manifest(root: &Path) -> Result<Vec<ReceiptFile>, ResourceMigrationError> {
    let mut files = Vec::new();
    visit(root, root, &mut files)?;
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(files)
}

fn visit(
    root: &Path,
    directory: &Path,
    files: &mut Vec<ReceiptFile>,
) -> Result<(), ResourceMigrationError> {
    move_control::check()?;
    for entry in fs::read_dir(directory)? {
        move_control::check()?;
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(ResourceMigrationError::Integrity(
                "资源目录包含符号链接".into(),
            ));
        }
        if kind.is_dir() {
            visit(root, &entry.path(), files)?;
        } else if kind.is_file() {
            let mut file = fs::File::open(entry.path())?;
            let mut hash = Sha256::new();
            let mut size = 0;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                move_control::check()?;
                let count = file.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                size += count as u64;
                hash.update(&buffer[..count]);
            }
            files.push(ReceiptFile {
                relative_path: entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|_| ResourceMigrationError::Integrity("资源路径超出目录".into()))?
                    .to_string_lossy()
                    .replace('\\', "/"),
                size,
                sha256: format!("{:x}", hash.finalize()),
            });
        }
    }
    Ok(())
}

pub(super) fn copy_tree(source: &Path, target: &Path) -> Result<(), ResourceMigrationError> {
    move_control::check()?;
    reject_symlink(target)?;
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        move_control::check()?;
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(ResourceMigrationError::Integrity(
                "资源目录包含符号链接".into(),
            ));
        }
        let output = target.join(entry.file_name());
        reject_symlink(&output)?;
        if kind.is_dir() {
            copy_tree(&entry.path(), &output)?;
        } else if kind.is_file() {
            if files_match(&entry.path(), &output)? {
                continue;
            }
            let mut source = fs::File::open(entry.path())?;
            // Unlink a previous partial copy instead of truncating a possible
            // hard link to another file.
            if output.exists() {
                fs::remove_file(&output)?;
            }
            let mut target = fs::File::create(output)?;
            copy_bytes(&mut source, &mut target)?;
            target.sync_all()?;
        }
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), ResourceMigrationError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(
            ResourceMigrationError::Integrity("复制恢复目录包含符号链接".into()),
        ),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn files_match(source: &Path, target: &Path) -> Result<bool, ResourceMigrationError> {
    move_control::check()?;
    reject_symlink(target)?;
    if !target.is_file() || fs::metadata(source)?.len() != fs::metadata(target)?.len() {
        return Ok(false);
    }
    let mut source = fs::File::open(source)?;
    let mut target = fs::File::open(target)?;
    let mut left = [0_u8; 64 * 1024];
    let mut right = [0_u8; 64 * 1024];
    loop {
        move_control::check()?;
        let count = source.read(&mut left)?;
        if count == 0 {
            return Ok(true);
        }
        target.read_exact(&mut right[..count])?;
        if left[..count] != right[..count] {
            return Ok(false);
        }
    }
}

pub(super) fn remaining_bytes(
    source: &Path,
    target: &Path,
    files: &[ReceiptFile],
) -> Result<u64, ResourceMigrationError> {
    // Check the entire existing tree before following any destination ancestor.
    if target.exists() {
        manifest(target)?;
    }
    let mut remaining = 0_u64;
    for file in files {
        if !files_match(
            &source.join(&file.relative_path),
            &target.join(&file.relative_path),
        )? {
            remaining = remaining.saturating_add(file.size);
        }
    }
    Ok(remaining)
}

fn copy_bytes(
    source: &mut impl Read,
    target: &mut impl Write,
) -> Result<(), ResourceMigrationError> {
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        move_control::check()?;
        let count = source.read(&mut buffer)?;
        if count == 0 {
            return Ok(());
        }
        target.write_all(&buffer[..count])?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resumed_copy_keeps_verified_files_and_replaces_incomplete_files() {
        let fixture = tempfile::tempdir().unwrap();
        let source = fixture.path().join("source");
        let target = fixture.path().join("staging");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("complete"), b"verified").unwrap();
        fs::write(target.join("complete"), b"verified").unwrap();
        fs::write(source.join("partial"), b"complete contents").unwrap();
        fs::write(target.join("partial"), b"incom").unwrap();
        fs::File::options()
            .write(true)
            .open(target.join("complete"))
            .unwrap()
            .set_times(
                fs::FileTimes::new()
                    .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(60)),
            )
            .unwrap();
        let before = fs::metadata(target.join("complete"))
            .unwrap()
            .modified()
            .unwrap();
        copy_tree(&source, &target).unwrap();
        assert_eq!(
            fs::metadata(target.join("complete"))
                .unwrap()
                .modified()
                .unwrap(),
            before
        );
        assert_eq!(
            fs::read(target.join("partial")).unwrap(),
            b"complete contents"
        );
        assert_eq!(manifest(&source).unwrap(), manifest(&target).unwrap());
    }

    #[test]
    fn nested_destination_is_rejected_before_copying() {
        let fixture = tempfile::tempdir().unwrap();
        let source = fixture.path().join("resources");
        let nested = source.join("nested");
        let sibling = fixture.path().join("resources-other");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        assert!(validate_destination(&source, &nested).is_err());
        assert!(validate_destination(&source, &source).is_err());
        assert!(validate_destination(&source, &sibling).is_ok());
    }

    #[test]
    fn cancellation_stops_copy_before_reading_the_next_chunk() {
        struct CancellingReader {
            id: String,
            reads: usize,
        }
        impl Read for CancellingReader {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                self.reads += 1;
                assert_eq!(self.reads, 1, "cancelled copy must not keep reading");
                buffer.fill(7);
                assert!(move_control::cancel(&self.id).unwrap());
                Ok(buffer.len())
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let mut source = CancellingReader {
            id: id.clone(),
            reads: 0,
        };
        let mut output = Vec::new();
        let result = move_control::register(&id)
            .unwrap()
            .run(|| copy_bytes(&mut source, &mut output));
        assert!(matches!(result, Err(ResourceMigrationError::Cancelled)));
        assert_eq!(output.len(), 64 * 1024);
        assert_eq!(source.reads, 1);
    }
}
