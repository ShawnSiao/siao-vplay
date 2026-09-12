use super::{
    StorageError,
    migration_copy::{self, CopyEntry},
};
use std::{ffi::OsString, fs, path::Path, sync::atomic::AtomicBool};

pub(super) fn scan(
    source: &Path,
    database: Option<&Path>,
    bootstrap: &Path,
    cancelled: &AtomicBool,
) -> Result<Vec<CopyEntry>, StorageError> {
    // Tauri's default Windows WebView user-data root remains at bootstrap even
    // after application data moves. Never copy its live engine profile.
    let exclude_browser =
        database.is_some() && dunce::canonicalize(source)? == dunce::canonicalize(bootstrap)?;
    let retained = super::asset_policy::bootstrap_retained_names()?;
    migration_copy::scan_files_excluding(
        source,
        database,
        cancelled,
        if exclude_browser { &retained } else { &[] },
    )
}

pub(super) fn estimated_bytes(
    entries: &[CopyEntry],
    database: Option<&Path>,
) -> Result<u64, StorageError> {
    let mut bytes = entries
        .iter()
        .fold(0_u64, |total, entry| total.saturating_add(entry.bytes));
    if let Some(database) = database {
        let mut wal = OsString::from(database.as_os_str());
        wal.push("-wal");
        // Include live WAL bytes in the estimate for the SQLite backup; SHM is
        // coordination data and is neither copied nor part of the backup.
        for path in [database, Path::new(&wal)] {
            match fs::metadata(path) {
                Ok(metadata) => bytes = bytes.saturating_add(metadata.len()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_configuration_keeps_the_verified_default_webview_location() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        for window in config["app"]["windows"].as_array().unwrap() {
            assert!(
                window.get("dataDirectory").is_none(),
                "Update migration scope when overriding the WebView data directory"
            );
        }
    }
    #[test]
    fn bootstrap_browser_files_are_not_counted_but_database_wal_is() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        fs::create_dir(root.join("EBWebView")).unwrap();
        fs::write(root.join("EBWebView/Preferences"), b"browser").unwrap();
        fs::write(root.join("asset"), b"asset").unwrap();
        let database = root.join("data.db");
        fs::write(&database, b"db").unwrap();
        fs::write(root.join("data.db-wal"), b"wal").unwrap();
        fs::write(root.join("data.db-shm"), b"shm").unwrap();
        let files = scan(root, Some(&database), root, &AtomicBool::new(false)).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].relative, Path::new("asset"));
        assert_eq!(estimated_bytes(&files, Some(&database)).unwrap(), 10);
    }
    #[test]
    fn a_same_named_directory_outside_bootstrap_or_in_media_is_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("data");
        fs::create_dir_all(root.join("EBWebView")).unwrap();
        fs::write(root.join("EBWebView/user-file"), b"retain").unwrap();
        for (database, bootstrap) in [
            (Some(root.join("data.db")), directory.path()),
            (None, root.as_path()),
        ] {
            let files = scan(
                &root,
                database.as_deref(),
                bootstrap,
                &AtomicBool::new(false),
            )
            .unwrap();
            assert_eq!(files.len(), 1);
            assert_eq!(files[0].relative, Path::new("EBWebView/user-file"));
        }
    }
}
