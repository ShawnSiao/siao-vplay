use std::{
    env,
    path::{Path, PathBuf},
};

use super::*;

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
