use std::path::Path;

use super::app_status;

#[test]
fn app_status_uses_the_siaovplay_identity() {
    let status = app_status(Path::new("W:/SiaoVPlay/app-data"), None, 2);
    assert_eq!(status.interrupted_transcription_count, 2);

    assert_eq!(status.app_name, "SiaoVPlay");
    assert_eq!(status.platform, "windows-desktop");
    assert_eq!(status.data_directory, "W:/SiaoVPlay/app-data");
    assert_eq!(status.startup_media_path, None);
}
