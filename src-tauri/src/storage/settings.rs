use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
};

pub(crate) use super::settings_io::persist_settings;
use super::settings_io::{load_settings, SETTINGS_FILE_NAME};

use super::{
    StorageError,
    migration_state::{MigrationRuntime, load_migration_runtime},
    model::{SaveStorageSettingsInput, StorageSettingsFile, StorageSettingsView, settings_version},
    paths::{canonical_existing_directory, configured_path, directory_available, directory_size},
};


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
    #[cfg(test)]
    pub fn initialize(
        bootstrap_directory: &Path,
        default_app_data_root: PathBuf,
        environment_app_data_root: Option<PathBuf>,
    ) -> Result<Self, StorageError> {
        Self::initialize_internal(
            bootstrap_directory,
            default_app_data_root,
            environment_app_data_root,
            false,
        )
        .map(|(manager, _)| manager)
    }

    pub(crate) fn initialize_owned(
        bootstrap_directory: &Path,
        default_app_data_root: PathBuf,
        environment_app_data_root: Option<PathBuf>,
    ) -> Result<(Self, Option<crate::instance_lock::InstanceLock>), StorageError> {
        Self::initialize_internal(
            bootstrap_directory,
            default_app_data_root,
            environment_app_data_root,
            true,
        )
    }

    fn initialize_internal(
        bootstrap_directory: &Path,
        default_app_data_root: PathBuf,
        environment_app_data_root: Option<PathBuf>,
        acquire_owner: bool,
    ) -> Result<(Self, Option<crate::instance_lock::InstanceLock>), StorageError> {
        fs::create_dir_all(bootstrap_directory)?;
        let settings_path = bootstrap_directory.join(SETTINGS_FILE_NAME);
        let mut settings = load_settings(&settings_path)?;
        let legacy_pending = matches!(settings.version, 1 | 2);
        let upgrade_settings = legacy_pending;
        if upgrade_settings {
            if settings.version == 1 && settings.pending_migration_commit.is_some() { return Err(super::migration_commit::pending_error()); }
            settings.version = settings_version();
        }
        if settings.version != settings_version() {
            return Err(StorageError::UnsupportedVersion(settings.version));
        }
        if environment_app_data_root.is_some() && settings.pending_app_data_root.is_some() {
            return Err(StorageError::RootUnavailable("存在待切换的应用数据，请移除数据目录环境变量覆盖并完成切换后启动；原数据仍保留".to_owned()));
        }
        let pending_root = if environment_app_data_root.is_none() {
            settings.pending_app_data_root.as_deref().map(PathBuf::from)
                .filter(|root| root.is_dir() && root.join("projects/siaovplay.db").is_file())
        } else { None };
        if environment_app_data_root.is_none() && settings.pending_app_data_root.is_some() && pending_root.is_none() {
            return Err(StorageError::RootUnavailable("待切换的数据目录不可用，请重新连接目标磁盘后启动；原数据仍保留，未切换回旧库写入".to_owned()));
        }
        let active_root = environment_app_data_root
            .clone()
            .or_else(|| pending_root.clone())
            .or_else(|| settings.active_app_data_root.as_deref().map(PathBuf::from))
            .unwrap_or_else(|| default_app_data_root.clone());
        let owner = if acquire_owner {
            fs::create_dir_all(&active_root)?;
            if fs::canonicalize(&active_root)? != fs::canonicalize(bootstrap_directory)? {
                Some(crate::instance_lock::InstanceLock::acquire(&active_root)?)
            } else {
                None
            }
        } else {
            None
        };
        // Do not publish the new root or upgrade its bootstrap config until ownership succeeds.
        if let Some(root) = pending_root.as_deref() {
            match settings.pending_app_data_receipt.as_ref() {
                Some(receipt) => super::migration_receipt::verify_pending(bootstrap_directory, receipt, root)?,
                None if legacy_pending => {},
                None => return Err(StorageError::MigrationIntegrity("待切换的数据缺少校验记录，已保留原配置与数据".to_owned())),
            }
            promote_pending_app_data_root(&settings_path, &mut settings)?;
            if settings.pending_app_data_root.is_some() {
                return Err(StorageError::RootUnavailable("待切换的数据目录已不可用，未修改存储配置".to_owned()));
            }
        } else if upgrade_settings {
            persist_settings(&settings_path, &settings)?;
        }
        let committed_app_root = if environment_app_data_root.is_none() {
            settings.active_app_data_root.as_deref().map(Path::new)
        } else { None };
        let mut migration = load_migration_runtime(bootstrap_directory, committed_app_root)?;
        super::migration_commit::recover(&settings_path, &mut settings, &active_root, &mut migration)?;
        Ok((
            Self {
                state: Arc::new(RwLock::new(StorageState {
                    settings_path,
                    default_app_data_root,
                    environment_app_data_root,
                    settings,
                })),
                migration: Arc::new(Mutex::new(migration)),
            },
            owner,
        ))
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
        self.recover_migration_commit()?;
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

        let runtime = self.migration.lock().map_err(|_| StorageError::StatePoisoned)?;
        if runtime.users > 0 || runtime.task.as_ref().is_some_and(|task| task.status == super::StorageMigrationStatus::Running) {
            return Err(StorageError::MigrationBusy);
        }
        let mut state = self.write_state()?;
        if state.settings.pending_app_data_root.is_some() { return Err(StorageError::MigrationBusy); }
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
        let mut next = state.settings.clone();
        next.remote_media_root = remote_media_root;
        next.media_cache_root = media_cache_root;
        next.default_subtitle_export_directory = default_subtitle_export_directory;
        next.default_video_report_export_directory = default_video_report_export_directory;
        next.revision = next.revision.saturating_add(1);
        persist_settings(&state.settings_path, &next)?;
        state.settings = next;
        settings_view(&state)
    }

    pub(crate) fn read_state(
        &self,
    ) -> Result<std::sync::RwLockReadGuard<'_, StorageState>, StorageError> {
        let state = self.state.read().map_err(|_| StorageError::StatePoisoned)?;
        if state.settings.pending_migration_commit.is_some() { return Err(super::migration_commit::pending_error()); }
        Ok(state)
    }

    pub(crate) fn write_state(
        &self,
    ) -> Result<std::sync::RwLockWriteGuard<'_, StorageState>, StorageError> {
        let state = self.state.write().map_err(|_| StorageError::StatePoisoned)?;
        if state.settings.pending_migration_commit.is_some() { return Err(super::migration_commit::pending_error()); }
        Ok(state)
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
    settings.pending_app_data_receipt = None;
    settings.revision = settings.revision.saturating_add(1);
    persist_settings(settings_path, settings)
}
