mod agent_result;
mod agent_task_files;
mod verified_task_files;
mod ai;
mod ai_migration;
mod burn;
mod burn_migration;
mod burn_style;
mod codex_event_stream;
mod codex_runner;
mod codex_task_state;
mod commands;
mod ipc_handler;
mod delivery;
mod desktop_frame;
mod domain;
mod database_upgrade;
mod watch_state;
mod external_handoff;
mod external_result_delivery;
mod instance_lock;
mod learning;
mod library;
mod local_resources;
mod media;
mod process_group;
mod cancellable_process;
mod preparation;
mod preparation_commands;
mod public_connect_proxy;
mod public_video_source;
mod remote_media;
mod resource_diagnostics;
mod resource_commands;
mod resource_download;
mod resource_location;
mod resource_migration;
mod resource_usage;
mod resource_leases;
mod cleanup_confirmation;
mod cleanup_batch;
mod runtime;
mod speech;
mod storage;
mod store;
mod subtitles;
mod summary;
mod transcription;
mod translation;
mod storage_failure;
mod translation_dispatch;
mod translation_language;
#[cfg(test)]
mod translation_test_support;
mod understanding;
mod understanding_evidence;
mod understanding_v2;
mod x_public_video;
mod x_resolver_policy;
mod youtube_command_error;
mod youtube_media;

use std::path::{Path, PathBuf};

use serde::Serialize;
use store::ProjectStore;
use tauri::{Manager, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
struct AppStatus {
    app_name: &'static str,
    version: &'static str,
    platform: &'static str,
    data_directory: String,
    startup_media_path: Option<String>,
}

#[tauri::command]
fn app_status(data_directory: &Path, startup_media_path: Option<String>) -> AppStatus {
    AppStatus {
        app_name: "SiaoVPlay",
        version: env!("CARGO_PKG_VERSION"),
        platform: "windows-desktop",
        data_directory: data_directory.to_string_lossy().into_owned(),
        startup_media_path,
    }
}

struct StartupMediaPath(Option<String>);
struct AppInstanceLocks {
    _guards: Vec<instance_lock::InstanceLock>,
}

#[tauri::command]
fn get_app_status(
    store: State<'_, ProjectStore>,
    startup_media_path: State<'_, StartupMediaPath>,
) -> AppStatus {
    let data_directory = store
        .database_path()
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new("."));
    app_status(data_directory, startup_media_path.0.clone())
}

#[tauri::command]
fn set_main_window_media_title(
    window: tauri::WebviewWindow,
    media_title: Option<String>,
) -> Result<(), String> {
    desktop_frame::set_media_title(&window, media_title.as_deref())
        .map_err(|error| format!("无法更新 SiaoVPlay 窗口标题：{error}"))
}

fn initialize_storage(
    app: &tauri::App,
) -> Result<(storage::StorageManager, AppInstanceLocks), Box<dyn std::error::Error>> {
    let default_data_directory = app.path().app_local_data_dir()?;
    // Protect bootstrap settings and migration recovery before reading them.
    let mut guards = vec![instance_lock::InstanceLock::acquire(
        &default_data_directory,
    )?];
    let environment_data_directory = std::env::var_os("SIAOVPLAY_DATA_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let (storage, data_owner) = storage::StorageManager::initialize_owned(
        &default_data_directory,
        default_data_directory.clone(),
        environment_data_directory,
    )?;
    guards.extend(data_owner);
    Ok((storage, AppInstanceLocks { _guards: guards }))
}

fn resolve_startup_media_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

fn show_startup_storage_error() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONINFORMATION, MB_OK, MessageBoxW};
        let title: Vec<u16> = "SiaoVPlay\0".encode_utf16().collect();
        let message: Vec<u16> = "无法取得数据目录的独占访问权限。请先使用已打开的 SiaoVPlay 窗口；若没有其他窗口，请检查数据目录是否可访问。未打开项目数据库。\0".encode_utf16().collect();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                message.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONINFORMATION,
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                desktop_frame::apply(&window);
            } else {
                eprintln!("SiaoVPlay: main window was unavailable during native frame setup");
            }
            let (storage, instance_locks) = initialize_storage(app).inspect_err(|_| {
                show_startup_storage_error();
            })?;
            app.manage(instance_locks);
            let data_directory = storage.app_data_root()?;
            local_resources::initialize_managed(&data_directory, storage.clone())?;
            let legacy_proxy = local_resources::configured_proxy_url();
            ai::initialize(&data_directory, legacy_proxy.as_deref(), storage.clone())?;
            resource_download::initialize_for_startup()?;
            runtime::initialize(&data_directory)?;
            let database_path = data_directory.join("projects").join("siaovplay.db");
            let store = ProjectStore::open(database_path)?;
            store.recover_running_media_artifacts()?;
            transcription::recover_transcription_jobs(&store)?;
            codex_runner::recover_translation_tasks(&store)?;
            ai::translation_api::recover(&store)?;
            understanding::recover_explanation_tasks(&store)?;
            learning::recover_learning_tasks(&store)?;
            summary::recover_summary_tasks(&store)?;
            burn::recover_subtitle_burn_jobs(&store)?;
            app.manage(store);
            app.manage(external_result_delivery::DeliveryQueue::default());
            app.manage(storage);
            app.manage(StartupMediaPath(resolve_startup_media_path()));
            app.manage(library::LibraryPreviewStore::default());
            app.manage(library::LibraryRecoveryStore::default());
            Ok(())
        })
        .invoke_handler(ipc_handler::handler())
        .run(tauri::generate_context!())
        .expect("failed to run SiaoVPlay");
}

#[cfg(test)]
#[path = "app_identity_tests.rs"]
mod tests;

#[cfg(test)]
mod ipc_contracts;
#[cfg(test)]
mod task_material_migration_tests;
mod project_operations;
