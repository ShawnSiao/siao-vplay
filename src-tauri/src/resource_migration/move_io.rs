use super::{ReceiptFile, ResourceMigrationError, move_control};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

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
        if kind.is_dir() {
            copy_tree(&entry.path(), &output)?;
        } else if kind.is_file() {
            let mut source = fs::File::open(entry.path())?;
            let mut target = fs::File::create(output)?;
            copy_bytes(&mut source, &mut target)?;
            target.sync_all()?;
        }
    }
    Ok(())
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
