use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    app_name: &'static str,
    version: &'static str,
    platform: &'static str,
    data_directory: String,
}

#[tauri::command]
fn get_app_status() -> AppStatus {
    AppStatus {
        app_name: "SiaoVPlay",
        version: env!("CARGO_PKG_VERSION"),
        platform: "windows-desktop",
        data_directory: std::env::var("SIAOVPLAY_DATA_DIR")
            .unwrap_or_else(|_| "local-app-data".to_owned()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_app_status])
        .run(tauri::generate_context!())
        .expect("failed to run SiaoVPlay");
}

#[cfg(test)]
mod tests {
    use super::get_app_status;

    #[test]
    fn app_status_uses_the_siaovplay_identity() {
        let status = get_app_status();

        assert_eq!(status.app_name, "SiaoVPlay");
        assert_eq!(status.platform, "windows-desktop");
    }
}
