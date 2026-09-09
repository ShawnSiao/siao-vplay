use super::{
    StorageArea, StorageError, StorageMigrationMode, StorageMigrationTask, migration_copy,
    migration_stream,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum FileKind {
    CopiedFile,
    RewrittenDatabase,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct VerifiedFile {
    relative: String,
    pub(super) bytes: u64,
    sha256: String,
    kind: FileKind,
}

impl VerifiedFile {
    pub(super) fn copied(
        relative: &Path,
        target: &Path,
        sha256: String,
    ) -> Result<Self, StorageError> {
        let relative = relative.to_str().ok_or_else(invalid)?.replace('\\', "/");
        Ok(Self {
            relative,
            bytes: fs::metadata(target)?.len(),
            sha256,
            kind: FileKind::CopiedFile,
        })
    }
    pub(super) fn database(
        destination: &Path,
        cancelled: &AtomicBool,
    ) -> Result<Self, StorageError> {
        let relative = Path::new("projects/siaovplay.db");
        let path = destination.join(relative);
        let mut file = Self::copied(
            relative,
            &path,
            migration_copy::file_sha256(&path, cancelled)?,
        )?;
        file.kind = FileKind::RewrittenDatabase;
        Ok(file)
    }
}

// This is a pre-commit content receipt, not a permanent ownership or backup claim.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    schema_version: u32,
    task_id: String,
    area: StorageArea,
    mode: StorageMigrationMode,
    source_root: String,
    destination_root: String,
    files: Vec<VerifiedFile>,
}

fn invalid() -> StorageError {
    StorageError::MigrationIntegrity(
        "迁移校验记录缺失、无效或版本不受支持；请检查记录版本或恢复原记录后重试，存储位置未切换"
            .to_owned(),
    )
}

fn validate(receipt: &Receipt, task: &StorageMigrationTask) -> Result<(), StorageError> {
    if receipt.schema_version != 1
        || receipt.task_id != task.id
        || receipt.area != task.area
        || receipt.mode != task.mode
        || receipt.source_root != task.source_root
        || receipt.destination_root != task.destination_root
    {
        return Err(invalid());
    }
    validate_content(receipt)
}

fn validate_content(receipt: &Receipt) -> Result<(), StorageError> {
    let mut paths = HashSet::new();
    let mut databases = 0;
    for file in &receipt.files {
        if file.relative.contains(['\\', ':', '\0'])
            || file
                .relative
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || !paths.insert(&file.relative)
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(invalid());
        }
        if matches!(file.kind, FileKind::RewrittenDatabase) {
            if file.relative != "projects/siaovplay.db" {
                return Err(invalid());
            }
            databases += 1;
        }
    }
    let expected = usize::from(receipt.area == StorageArea::AppData);
    if databases != expected
        || (receipt.mode == StorageMigrationMode::Rebuild
            && (receipt.area != StorageArea::MediaCache || !receipt.files.is_empty()))
    {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn persist(
    bootstrap: &Path,
    task: &StorageMigrationTask,
    files: Vec<VerifiedFile>,
    cancelled: &AtomicBool,
) -> Result<ReceiptReference, StorageError> {
    migration_stream::check(cancelled)?;
    // Never interpret task identity as an arbitrary filename.
    if uuid::Uuid::parse_str(&task.id).is_err() || task.id.len() != 36 {
        return Err(invalid());
    }
    let path = bootstrap.join(format!("storage-migration.{}.receipt.json", task.id));
    let receipt = Receipt {
        schema_version: 1,
        task_id: task.id.clone(),
        area: task.area,
        mode: task.mode,
        source_root: task.source_root.clone(),
        destination_root: task.destination_root.clone(),
        files,
    };
    validate(&receipt, task)?;
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => {
            let existing: Receipt =
                serde_json::from_slice(&fs::read(&path)?).map_err(|_| invalid())?;
            validate(&existing, task)?;
        }
        Ok(_) => return Err(invalid()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let bytes = serde_json::to_vec(&receipt)?;
    let reference = ReceiptReference {
        version: 1,
        task_id: task.id.clone(),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
    };
    write_atomic(&path, &bytes, cancelled)?;
    Ok(reference)
}

fn write_atomic(path: &Path, bytes: &[u8], cancelled: &AtomicBool) -> Result<(), StorageError> {
    let temporary: PathBuf = path.with_file_name(format!(
        ".storage-receipt-{}.part",
        uuid::Uuid::new_v4().simple()
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let result = (|| {
        file.write_all(bytes)?;
        migration_stream::check(cancelled)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        migration_stream::check(cancelled)?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
#[path = "migration_receipt_validation_tests.rs"]
mod tests;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReceiptReference {
    version: u32,
    task_id: String,
    sha256: String,
}

pub(super) fn verify_pending(
    bootstrap: &Path,
    reference: &ReceiptReference,
    destination: &Path,
) -> Result<(), StorageError> {
    if reference.version != 1
        || reference.task_id.len() != 36
        || uuid::Uuid::parse_str(&reference.task_id).is_err()
    {
        return Err(invalid());
    }
    let path = bootstrap.join(format!(
        "storage-migration.{}.receipt.json",
        reference.task_id
    ));
    let metadata = fs::symlink_metadata(&path).map_err(|_| invalid())?;
    if !metadata.is_file() || metadata.is_symlink() {
        return Err(invalid());
    }
    let bytes = fs::read(path).map_err(|_| invalid())?;
    if format!("{:x}", Sha256::digest(&bytes)) != reference.sha256 {
        return Err(invalid());
    }
    let receipt: Receipt = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if receipt.schema_version != 1
        || receipt.task_id != reference.task_id
        || receipt.area != StorageArea::AppData
        || receipt.mode != StorageMigrationMode::Copy
        || Path::new(&receipt.destination_root) != destination
    {
        return Err(invalid());
    }
    validate_content(&receipt)?;
    let root = dunce::canonicalize(destination)?;
    let cancelled = AtomicBool::new(false);
    for file in &receipt.files {
        let failure = || {
            StorageError::MigrationIntegrity(format!(
                "待切换文件校验失败：{}；请检查文件或恢复原文件后重试，存储位置未切换",
                file.relative
            ))
        };
        let mut path = root.clone();
        // Reject links in every component before opening a recorded file.
        for component in file.relative.split('/') {
            path.push(component);
            if fs::symlink_metadata(&path)
                .map_err(|_| failure())?
                .is_symlink()
            {
                return Err(failure());
            }
        }
        let metadata = fs::metadata(&path).map_err(|_| failure())?;
        if !metadata.is_file()
            || metadata.len() != file.bytes
            || !dunce::canonicalize(&path)
                .map_err(|_| failure())?
                .starts_with(&root)
            || migration_copy::file_sha256(&path, &cancelled).map_err(|_| failure())? != file.sha256
        {
            return Err(failure());
        }
    }
    Ok(())
}
