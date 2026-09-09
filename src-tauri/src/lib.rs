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
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            ai::translation_api::prepare_api_translation,
            ai::translation_api::start_api_translation,
            set_main_window_media_title,
            commands::create_local_project,
            commands::open_local_project,
            commands::inspect_remote_media_url,
            commands::import_remote_media_url,
            commands::cancel_remote_media_import,
            commands::inspect_youtube_url,
            commands::get_public_resolver_disclosure,
            commands::import_youtube_url,
            commands::cancel_youtube_import,
            commands::list_projects,
            library::commands::get_library_home,
            library::commands::list_library_section,
            library::commands::search_library,
            library::commands::create_collection,
            library::commands::update_collection,
            library::commands::delete_collection,
            library::commands::get_collection_detail,
            library::commands::list_collection_episodes,
            library::commands::add_project_to_collection,
            library::commands::remove_project_from_collection,
            library::commands::get_episode_neighbors,
            library::commands::set_watch_later,
            library::commands::scan_library_folder,
            library::commands::cancel_library_scan,
            library::commands::confirm_library_import,
            library::commands::inspect_library_rescan,
            library::commands::apply_library_rescan,
            library::commands::inspect_library_root_rebuild,
            library::commands::apply_library_root_rebuild,
            library::commands::revoke_library_root,
            library::commands::inspect_library_root_relocation,
            library::commands::apply_library_root_relocation,
            library::commands::open_project_media_location,
            commands::get_project,
            commands::mark_project_opened,
            commands::update_playback_state,
            watch_state::set_project_watched,
            commands::relink_project_media,
            commands::delete_project,
            commands::get_media_runtime_status,
            commands::get_local_resource_catalog,
            commands::get_local_resource_status,
            commands::plan_local_resource_location,
            commands::configure_local_resource_root,
            commands::retry_local_resource_binding,
            commands::inspect_local_resource_binding,
            commands::repair_local_resource_root,
            commands::set_local_resource_profile,
            ai::commands::get_local_resource_network_status,
            ai::commands::set_local_resource_proxy,
            resource_commands::inspect_local_resource_migration,
            resource_commands::adopt_local_resources,
            resource_commands::plan_local_resource_move,
            resource_commands::move_local_resource_root,
            resource_commands::cancel_local_resource_move,
            resource_commands::reconnect_local_resource_root,
            resource_commands::plan_unused_resource_cleanup,
            resource_commands::cleanup_unused_resources,
            commands::list_resource_download_tasks,
            commands::prepare_local_capability,
            commands::pause_resource_download,
            commands::resume_resource_download,
            commands::cancel_resource_download,
            commands::retry_resource_download,
            commands::repair_local_resource,
            commands::update_local_resource,
            commands::remove_local_resource,
            commands::get_local_resource_diagnostics,
            commands::get_local_resource_diagnostic_summary,
            commands::get_local_resource_third_party_notices,
            ai::commands::get_ai_service_settings,
            ai::commands::save_ai_service,
            ai::commands::delete_ai_service,
            ai::commands::set_default_ai_service,
            ai::commands::list_ai_service_models,
            ai::commands::test_ai_service,
            ai::commands::preview_ai_execution,
            storage::commands::get_storage_settings,
            storage::commands::save_storage_settings,
            storage::commands::prepare_storage_migration,
            storage::commands::start_storage_migration,
            storage::commands::resume_storage_migration,
            storage::commands::get_storage_migration,
            storage::commands::get_current_storage_migration,
            storage::commands::cancel_storage_migration,
            storage::commands::open_storage_location,
            storage::commands::clear_playback_cache,
            storage::commands::restart_after_storage_migration,
            summary::commands::list_analysis_prompt_templates,
            summary::commands::save_analysis_prompt_templates,
            summary::commands::delete_analysis_prompt_templates,
            summary::commands::prepare_summary_task,
            summary::commands::open_summary_materials,
            summary::commands::start_summary_task,
            summary::commands::preview_summary_dispatch,
            summary::commands::resume_summary_task,
            summary::commands::cancel_summary_task,
            summary::commands::get_summary_task,
            summary::commands::list_summary_tasks,
            summary::commands::list_summary_activity,
            summary::commands::get_video_summary,
            summary::commands::list_video_summaries,
            summary::commands::export_video_summary,
            speech::commands::list_speech_voices,
            speech::commands::synthesize_speech,
            ai::commands::prepare_ai_explanation_task,
            ai::commands::preview_ai_task_dispatch,
            ai::commands::resume_explanation_task,
            ai::commands::prepare_ai_learning_task,
            ai::commands::resume_learning_task,
            ai::commands::get_network_settings,
            ai::commands::set_network_settings,
            commands::rollback_local_resource,
            commands::plan_old_resource_version_cleanup,
            commands::cleanup_old_resource_versions,
            commands::get_runtime_catalog,
            commands::inspect_project_media,
            preparation_commands::prepare_project_media,
            preparation_commands::get_media_preparation,
            preparation_commands::cancel_media_preparation,
            commands::ensure_project_poster,
            commands::inspect_subtitle_file,
            commands::import_subtitle_file,
            commands::list_subtitle_versions,
            commands::get_subtitle_version,
            subtitles::metadata::list_subtitle_version_metadata,
            commands::revise_subtitle_version,
            commands::restore_subtitle_version,
            commands::inspect_embedded_subtitle,
            commands::import_embedded_subtitle,
            commands::get_transcription_runtime_status,
            commands::start_transcription,
            commands::get_transcription_job,
            commands::list_transcription_jobs,
            commands::cancel_transcription_job,
            commands::resume_transcription_job,
            commands::prepare_translation_task,
            translation_dispatch::preview_translation_dispatch,
            commands::get_translation_task,
            commands::list_translation_tasks,
            commands::read_translation_prompt,
            commands::import_translation_result,
            commands::get_codex_runtime_status,
            commands::start_codex_translation_task,
            commands::cancel_translation_task,
            commands::resume_codex_translation_task,
            commands::prepare_explanation_task,
            commands::get_explanation_task,
            commands::list_explanation_tasks,
            commands::read_explanation_prompt,
            commands::open_explanation_materials,
            commands::get_explanation,
            understanding_evidence::get_explanation_evidence,
            commands::list_explanations,
            commands::import_explanation_result,
            commands::start_codex_explanation_task,
            commands::cancel_explanation_task,
            commands::resume_codex_explanation_task,
            commands::prepare_learning_task,
            commands::get_learning_task,
            commands::list_learning_tasks,
            commands::read_learning_prompt,
            commands::get_dictionary_entry,
            commands::list_dictionary_entries,
            commands::import_learning_result,
            commands::start_codex_learning_task,
            commands::cancel_learning_task,
            commands::resume_codex_learning_task,
            commands::create_learning_card,
            commands::get_learning_card,
            commands::list_learning_cards,
            commands::delete_learning_card,
            commands::export_learning_cards,
            commands::reconcile_external_agent_results,
            commands::acknowledge_external_agent_results,
            commands::open_external_result_directory,
            commands::export_subtitles,
            commands::start_subtitle_burn,
            commands::get_subtitle_burn_job,
            commands::list_subtitle_burn_jobs,
            commands::cancel_subtitle_burn_job,
            commands::resume_subtitle_burn_job
        ])
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
