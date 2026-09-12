use std::{
    env,
    path::{Path, PathBuf},
};

use super::*;

#[test]
fn disk_full_errors_keep_an_actionable_code_at_the_command_boundary() {
    for error in [
        MediaError::FileSystem(std::io::ErrorKind::StorageFull.into()),
        MediaError::Store(StoreError::FileSystem(std::io::ErrorKind::StorageFull.into())),
        MediaError::ProxyFailed("av_interleaved_write_frame(): No space left on device".into()),
    ] {
        let failure = crate::commands::CommandError::from(error);
        assert_eq!(failure.code, "insufficient_storage");
    }
}

#[test]
#[ignore = "requires SIAOVPLAY_PROJECT_DATABASE, SIAOVPLAY_PROJECT_ID and the local FFmpeg runtime"]
fn real_persistent_project_playback_proxy() {
    let database_path = env::var_os("SIAOVPLAY_PROJECT_DATABASE")
        .map(PathBuf::from)
        .expect("SIAOVPLAY_PROJECT_DATABASE must be set");
    let project_id = env::var("SIAOVPLAY_PROJECT_ID").expect("SIAOVPLAY_PROJECT_ID must be set");
    let runtime = MediaRuntime::resolve().expect("FFmpeg runtime should resolve");
    let store = ProjectStore::open(database_path).expect("project store should open");

    let preparation = prepare_project_media(
        &store,
        &store.data_directory().join("media-cache"),
        PrepareProjectMediaInput {
            project_id,
            force_proxy: true,
        },
    )
    .expect("playback proxy should be generated");

    assert_eq!(preparation.playback_source_kind, PlaybackSourceKind::Proxy);
    assert!(playback_proxy_is_valid(
        &runtime,
        Path::new(&preparation.playback_path)
    ));
}
