use super::{StorageError, migration_copy, migration_receipt::VerifiedFile, migration_stream};
use std::{fs, path::Path, sync::atomic::AtomicBool};

pub(super) fn apply(
    source: &Path,
    destination: &Path,
    files: &mut [VerifiedFile],
    cancelled: &AtomicBool,
) -> Result<(), StorageError> {
    migration_stream::check(cancelled)?;
    crate::local_resources::ensure_ready_for_data_move(destination)
        .map_err(|error| StorageError::MigrationIntegrity(error.to_string()))?;
    for file in files {
        if !matches!(
            file.relative.as_str(),
            "local-resources.json" | "runtime-settings.json"
        ) {
            continue;
        }
        migration_stream::check(cancelled)?;
        let path = destination.join(&file.relative);
        let bytes = fs::read(&path)?;
        if let Some(updated) = crate::local_resources::relocate_data_config(
            &file.relative,
            &bytes,
            source,
            destination,
        )
        .map_err(|error| StorageError::MigrationIntegrity(error.to_string()))?
        {
            migration_copy::replace_bytes(&path, &updated, cancelled)?;
            file.refresh_configuration(destination, cancelled)?;
        }
    }
    Ok(())
}
