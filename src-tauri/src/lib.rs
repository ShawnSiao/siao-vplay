mod codex_runner;
mod commands;
mod delivery;
mod domain;
mod learning;
mod media;
mod remote_media;
mod store;
mod subtitles;
mod transcription;
mod translation;
mod understanding;
mod youtube_media;

use std::path::{Path, PathBuf};

use serde::Serialize;
use store::ProjectStore;
use tauri::{Manager, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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

fn resolve_data_directory(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(data_directory) = std::env::var_os("SIAOVPLAY_DATA_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return Ok(data_directory);
    }
    Ok(app.path().app_local_data_dir()?)
}

fn resolve_startup_media_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_directory = resolve_data_directory(app)?;
            let database_path = data_directory.join("projects").join("siaovplay.db");
            let store = ProjectStore::open(database_path)?;
            store.recover_running_media_artifacts()?;
            transcription::recover_transcription_jobs(&store)?;
            codex_runner::recover_translation_tasks(&store)?;
            understanding::recover_explanation_tasks(&store)?;
            learning::recover_learning_tasks(&store)?;
            app.manage(store);
            app.manage(StartupMediaPath(resolve_startup_media_path()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            commands::create_local_project,
            commands::inspect_remote_media_url,
            commands::import_remote_media_url,
            commands::cancel_remote_media_import,
            commands::inspect_youtube_url,
            commands::import_youtube_url,
            commands::cancel_youtube_import,
            commands::list_projects,
            commands::get_project,
            commands::mark_project_opened,
            commands::update_playback_state,
            commands::relink_project_media,
            commands::delete_project,
            commands::get_media_runtime_status,
            commands::inspect_project_media,
            commands::prepare_project_media,
            commands::ensure_project_poster,
            commands::inspect_subtitle_file,
            commands::import_subtitle_file,
            commands::list_subtitle_versions,
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
            commands::export_subtitles
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SiaoVPlay");
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::app_status;

    #[test]
    fn app_status_uses_the_siaovplay_identity() {
        let status = app_status(Path::new("W:/SiaoVPlay/app-data"), None);

        assert_eq!(status.app_name, "SiaoVPlay");
        assert_eq!(status.platform, "windows-desktop");
        assert_eq!(status.data_directory, "W:/SiaoVPlay/app-data");
        assert_eq!(status.startup_media_path, None);
    }
}
