use super::*;
use crate::domain::{SubtitleDisplayMode, UpdatePlaybackStateInput};

#[test]
fn two_app_data_moves_keep_nested_library_media_and_playback_state() {
    let directory = tempfile::tempdir().unwrap();
    let bootstrap = directory.path().join("app");
    let nested = bootstrap.join("Movies");
    let external = directory.path().join("external");
    fs::create_dir_all(&nested).unwrap();
    fs::create_dir(&external).unwrap();
    let media = nested.join("clip.mp4");
    fs::write(&media, b"isolated media fixture").unwrap();
    let mut manager = StorageManager::initialize(&bootstrap, bootstrap.clone(), None).unwrap();
    let mut store = ProjectStore::open(bootstrap.join("projects/siaovplay.db")).unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: media.to_string_lossy().into_owned(),
            title: Some("Retained".into()),
        })
        .unwrap();
    store
        .update_playback_state(UpdatePlaybackStateInput {
            completed: None,
            project_id: project.id.clone(),
            position_ms: 1234,
            duration_ms: Some(10000),
            volume: 0.7,
            playback_rate: 1.25,
            subtitle_mode: SubtitleDisplayMode::Bilingual,
        })
        .unwrap();
    {
        let connection = rusqlite::Connection::open(store.database_path()).unwrap();
        for (id, path) in [("nested", &nested), ("external", &external)] {
            let key = path.to_string_lossy().replace('/', "\\");
            #[cfg(windows)]
            let key = key.to_lowercase();
            connection.execute("INSERT INTO library_roots(id,path,path_key,display_name,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?1,0,0)", rusqlite::params![id, path.to_string_lossy(), key]).unwrap();
        }
        connection.execute_batch("INSERT INTO collections(id,kind,title,root_id,created_at_ms,updated_at_ms) VALUES ('folder','folder','Retained folder','nested',0,0);").unwrap();
    }
    for name in ["second", "third"] {
        let destination = directory.path().join(name);
        fs::create_dir(&destination).unwrap();
        let task = prepare(
            &manager,
            StorageArea::AppData,
            &destination,
            StorageMigrationMode::Copy,
        );
        manager
            .start_migration(
                store.database_path().to_path_buf(),
                StartStorageMigrationInput {
                    task_id: task.id.clone(),
                    confirmed: true,
                },
            )
            .unwrap();
        let completed = wait_for_task(&manager, &task.id);
        assert_eq!(
            completed.status,
            StorageMigrationStatus::RestartRequired,
            "{:?}",
            completed.error_message
        );
        drop(store);
        drop(manager);
        manager = StorageManager::initialize(&bootstrap, bootstrap.clone(), None).unwrap();
        store = ProjectStore::open(destination.join("projects/siaovplay.db")).unwrap();
        let restored = store.get_project(&project.id).unwrap();
        assert_eq!(
            Path::new(&restored.media_source.locator),
            destination.join("Movies/clip.mp4")
        );
        assert_eq!(
            fs::read(&restored.media_source.locator).unwrap(),
            b"isolated media fixture"
        );
        assert_eq!(restored.playback_state.position_ms, 1234);
        assert_eq!(restored.playback_state.volume, 0.7);
        assert_eq!(restored.playback_state.playback_rate, 1.25);
        assert_eq!(
            restored.playback_state.subtitle_mode,
            SubtitleDisplayMode::Bilingual
        );
        let connection = rusqlite::Connection::open(store.database_path()).unwrap();
        let (path, root_id): (String, String) = connection.query_row("SELECT r.path,c.root_id FROM library_roots r JOIN collections c ON c.root_id=r.id WHERE c.id='folder'", [], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(Path::new(&path), destination.join("Movies"));
        assert!(Path::new(&path).is_dir());
        assert_eq!(root_id, "nested");
        assert_eq!(
            connection
                .query_row(
                    "SELECT path FROM library_roots WHERE id='external'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            external.to_string_lossy()
        );
    }
    assert_eq!(fs::read(media).unwrap(), b"isolated media fixture");
}
