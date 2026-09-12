use std::{
    path::{Path, PathBuf},
    process::Command,
};

use super::{
    ClearPlaybackCacheResult, StorageError, StorageLocationKind, StorageManager, database,
};

pub(crate) fn open_location(
    storage: &StorageManager,
    kind: StorageLocationKind,
) -> Result<(), StorageError> {
    let path = location_path(storage, kind)?;
    if !path.is_dir() {
        return Err(StorageError::RootUnavailable(
            "此位置当前不可用，请重新连接磁盘或重新选择".to_owned(),
        ));
    }
    open_directory(&path)
}

pub(crate) fn clear_playback_cache(
    storage: &StorageManager,
    database_path: &Path,
    confirmed: bool,
) -> Result<ClearPlaybackCacheResult, StorageError> {
    if !confirmed {
        return Err(StorageError::ConfirmationRequired);
    }
    // Hold admission until cleanup finishes; starting a migration uses this same lock.
    let migration = storage.migration.lock().map_err(|_| StorageError::StatePoisoned)?;
    if migration.users > 0 || migration.task.as_ref().is_some_and(|task| task.status == super::StorageMigrationStatus::Running) {
        return Err(StorageError::MigrationBusy);
    }
    let _database_owner = super::database_access::exclusive(database_path)?;
    database::ensure_idle(database_path)?;
    let root = storage.media_cache_root()?;
    let app_root = storage.app_data_root()?;
    let root = dunce::canonicalize(&root)?;
    let app_root = dunce::canonicalize(&app_root)?;
    if root == app_root || app_root.starts_with(&root) {
        return Err(StorageError::InvalidPath(
            "播放缓存位置与应用数据根目录边界不安全".to_owned(),
        ));
    }
    let reclaimed_bytes = super::cache_inventory::clear_recorded_cache(database_path, &root)?;
    Ok(ClearPlaybackCacheResult { reclaimed_bytes })
}

fn location_path(
    storage: &StorageManager,
    kind: StorageLocationKind,
) -> Result<PathBuf, StorageError> {
    let settings = storage.get_settings()?;
    let value = match kind {
        StorageLocationKind::AppData => Some(settings.app_data_root),
        StorageLocationKind::RemoteMedia => Some(settings.remote_media_root),
        StorageLocationKind::MediaCache => Some(settings.media_cache_root),
        StorageLocationKind::SubtitleExport => settings.default_subtitle_export_directory,
        StorageLocationKind::VideoReportExport => settings.default_video_report_export_directory,
    };
    value
        .map(PathBuf::from)
        .ok_or_else(|| StorageError::RootUnavailable("尚未设置默认保存位置".to_owned()))
}

#[cfg(windows)]
fn open_directory(path: &Path) -> Result<(), StorageError> {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    use std::os::windows::process::CommandExt;
    Command::new("explorer.exe")
        .arg(path)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;
    Ok(())
}

#[cfg(not(windows))]
fn open_directory(_path: &Path) -> Result<(), StorageError> {
    Err(StorageError::RootUnavailable(
        "当前平台不支持打开文件夹".to_owned(),
    ))
}
