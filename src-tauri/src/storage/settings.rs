use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
};

use uuid::Uuid;

use super::{
    StorageError,
    migration_state::{MigrationRuntime, load_migration_runtime},
    model::{SaveStorageSettingsInput, StorageSettingsFile, StorageSettingsView, settings_version},
    paths::{canonical_existing_directory, configured_path, directory_available, directory_size},
};

const SETTINGS_FILE_NAME: &str = "storage-settings.json";

#[derive(Clone, Debug)]
pub struct StorageManager {
    pub(crate) state: Arc<RwLock<StorageState>>,
    pub(crate) migration: Arc<Mutex<MigrationRuntime>>,
}

#[derive(Debug)]
pub(crate) struct StorageState {
    pub(crate) settings_path: PathBuf,
    pub(crate) default_app_data_root: PathBuf,
    pub(crate) environment_app_data_root: Option<PathBuf>,
    pub(crate) settings: StorageSettingsFile,
}

impl StorageManager {
    pub fn initialize(
        bootstrap_directory: &Path,
        default_app_data_root: PathBuf,
        environment_app_data_root: Option<PathBuf>,
    ) -> Result<Self, StorageError> {
        fs::create_dir_all(bootstrap_directory)?;
        let settings_path = bootstrap_directory.join(SETTINGS_FILE_NAME);
        let mut settings = load_settings(&settings_path)?;
        if settings.version != settings_version() {
            return Err(StorageError::UnsupportedVersion(settings.version));
        }
        if environment_app_data_root.is_none() {
            promote_pending_app_data_root(&settings_path, &mut settings)?;
        }
        let active_root = environment_app_data_root
            .clone()
            .or_else(|| settings.active_app_data_root.as_deref().map(PathBuf::from))
            .unwrap_or_else(|| default_app_data_root.clone());
        let migration = load_migration_runtime(bootstrap_directory, &active_root)?;
        Ok(Self {
            state: Arc::new(RwLock::new(StorageState {
                settings_path,
                default_app_data_root,
                environment_app_data_root,
                settings,
            })),
            migration: Arc::new(Mutex::new(migration)),
        })
    }

    pub fn app_data_root(&self) -> Result<PathBuf, StorageError> {
        let state = self.read_state()?;
        Ok(active_app_data_root(&state))
    }

    pub fn remote_media_root(&self) -> Result<PathBuf, StorageError> {
        let state = self.read_state()?;
        let app_root = active_app_data_root(&state);
        Ok(configured_path(
            state.settings.remote_media_root.as_deref(),
            app_root.join("remote-media"),
        ))
    }

    pub fn remote_media_root_for_write(&self) -> Result<PathBuf, StorageError> {
        let state = self.read_state()?;
        let app_root = active_app_data_root(&state);
        required_managed_root(
            state.settings.remote_media_root.as_deref(),
            app_root.join("remote-media"),
            "URL 导入视频位置",
        )
    }

    pub fn media_cache_root_for_write(&self) -> Result<PathBuf, StorageError> {
        let state = self.read_state()?;
        let app_root = active_app_data_root(&state);
        required_managed_root(
            state.settings.media_cache_root.as_deref(),
            app_root.join("media-cache"),
            "播放缓存位置",
        )
    }

    pub fn media_cache_root(&self) -> Result<PathBuf, StorageError> {
        let state = self.read_state()?;
        let app_root = active_app_data_root(&state);
        Ok(configured_path(
            state.settings.media_cache_root.as_deref(),
            app_root.join("media-cache"),
        ))
    }

    pub fn get_settings(&self) -> Result<StorageSettingsView, StorageError> {
        let state = self.read_state()?;
        settings_view(&state)
    }

    pub fn save_settings(
        &self,
        input: SaveStorageSettingsInput,
    ) -> Result<StorageSettingsView, StorageError> {
        let remote_media_root =
            canonical_existing_directory(input.remote_media_root, "URL 导入视频位置")?;
        let media_cache_root =
            canonical_existing_directory(input.media_cache_root, "播放缓存位置")?;
        let default_subtitle_export_directory = canonical_existing_directory(
            input.default_subtitle_export_directory,
            "默认字幕导出位置",
        )?;
        let default_video_report_export_directory = canonical_existing_directory(
            input.default_video_report_export_directory,
            "默认视频及报告位置",
        )?;
        if remote_media_root.is_some() && remote_media_root == media_cache_root {
            return Err(StorageError::InvalidPath(
                "URL 导入视频与播放缓存不能使用同一个文件夹".to_owned(),
            ));
        }

        let mut state = self.write_state()?;
        if input.expected_revision != state.settings.revision {
            return Err(StorageError::RevisionConflict {
                expected: input.expected_revision,
                actual: state.settings.revision,
            });
        }
        let app_root = active_app_data_root(&state);
        let current_remote = configured_path(
            state.settings.remote_media_root.as_deref(),
            app_root.join("remote-media"),
        );
        let next_remote =
            configured_path(remote_media_root.as_deref(), app_root.join("remote-media"));
        let current_cache = configured_path(
            state.settings.media_cache_root.as_deref(),
            app_root.join("media-cache"),
        );
        let next_cache = configured_path(media_cache_root.as_deref(), app_root.join("media-cache"));
        if (current_remote != next_remote && directory_size(&current_remote) > 0)
            || (current_cache != next_cache && directory_size(&current_cache) > 0)
        {
            return Err(StorageError::ManagedRootChangeRequiresMigration);
        }
        state.settings.remote_media_root = remote_media_root;
        state.settings.media_cache_root = media_cache_root;
        state.settings.default_subtitle_export_directory = default_subtitle_export_directory;
        state.settings.default_video_report_export_directory =
            default_video_report_export_directory;
        state.settings.revision = state.settings.revision.saturating_add(1);
        persist_settings(&state.settings_path, &state.settings)?;
        settings_view(&state)
    }

    pub(crate) fn read_state(
        &self,
    ) -> Result<std::sync::RwLockReadGuard<'_, StorageState>, StorageError> {
        self.state.read().map_err(|_| StorageError::StatePoisoned)
    }

    pub(crate) fn write_state(
        &self,
    ) -> Result<std::sync::RwLockWriteGuard<'_, StorageState>, StorageError> {
        self.state.write().map_err(|_| StorageError::StatePoisoned)
    }
}

pub(crate) fn active_app_data_root(state: &StorageState) -> PathBuf {
    state
        .environment_app_data_root
        .clone()
        .or_else(|| {
            state
                .settings
                .active_app_data_root
                .as_deref()
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| state.default_app_data_root.clone())
}

fn required_managed_root(
    configured: Option<&str>,
    fallback: PathBuf,
    label: &str,
) -> Result<PathBuf, StorageError> {
    let path = configured_path(configured, fallback);
    if configured.is_some() && !path.is_dir() {
        return Err(StorageError::RootUnavailable(format!(
            "{label}不可用，请重新连接磁盘或在存储设置中重新定位"
        )));
    }
    Ok(path)
}

fn settings_view(state: &StorageState) -> Result<StorageSettingsView, StorageError> {
    let app_data_root = active_app_data_root(state);
    let remote_media_root = configured_path(
        state.settings.remote_media_root.as_deref(),
        app_data_root.join("remote-media"),
    );
    let media_cache_root = configured_path(
        state.settings.media_cache_root.as_deref(),
        app_data_root.join("media-cache"),
    );
    Ok(StorageSettingsView {
        revision: state.settings.revision,
        app_data_root: path_string(&app_data_root),
        app_data_root_locked_by_environment: state.environment_app_data_root.is_some(),
        remote_media_root: path_string(&remote_media_root),
        remote_media_uses_default: state.settings.remote_media_root.is_none(),
        media_cache_root: path_string(&media_cache_root),
        media_cache_uses_default: state.settings.media_cache_root.is_none(),
        default_subtitle_export_directory: state.settings.default_subtitle_export_directory.clone(),
        default_video_report_export_directory: state
            .settings
            .default_video_report_export_directory
            .clone(),
        app_data_used_bytes: directory_size(&app_data_root),
        app_data_free_space_bytes: super::paths::available_space(&app_data_root),
        remote_media_used_bytes: directory_size(&remote_media_root),
        media_cache_used_bytes: directory_size(&media_cache_root),
        app_data_available: directory_available(&app_data_root),
        remote_media_available: directory_available(&remote_media_root),
        media_cache_available: directory_available(&media_cache_root),
        pending_app_data_root: state.settings.pending_app_data_root.clone(),
    })
}

fn load_settings(path: &Path) -> Result<StorageSettingsFile, StorageError> {
    if !path.exists() {
        return Ok(StorageSettingsFile::default());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub(crate) fn persist_settings(
    path: &Path,
    settings: &StorageSettingsFile,
) -> Result<(), StorageError> {
    let suffix = Uuid::new_v4().simple().to_string();
    let temporary = path.with_file_name(format!(".{SETTINGS_FILE_NAME}.{suffix}.part"));
    let previous = path.with_file_name(format!(".{SETTINGS_FILE_NAME}.{suffix}.previous"));
    fs::write(&temporary, serde_json::to_vec_pretty(settings)?)?;
    if path.exists() {
        fs::rename(path, &previous)?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if previous.exists() {
            let _ = fs::rename(&previous, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    if previous.exists() {
        fs::remove_file(previous)?;
    }
    Ok(())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn promote_pending_app_data_root(
    settings_path: &Path,
    settings: &mut StorageSettingsFile,
) -> Result<(), StorageError> {
    let Some(pending) = settings.pending_app_data_root.as_deref() else {
        return Ok(());
    };
    let root = PathBuf::from(pending);
    let database = root.join("projects").join("siaovplay.db");
    if !root.is_dir() || !database.is_file() {
        return Ok(());
    }
    super::database::verify_database(&database)?;
    settings.active_app_data_root = Some(pending.to_owned());
    settings.pending_app_data_root = None;
    settings.revision = settings.revision.saturating_add(1);
    persist_settings(settings_path, settings)
}
