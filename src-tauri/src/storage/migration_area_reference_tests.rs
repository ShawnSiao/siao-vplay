use super::*;
use rusqlite::{Connection, params};

#[test]
fn remote_copy_keeps_registered_folder_and_file_references_together() {
    check(StorageArea::RemoteMedia, StorageMigrationMode::Copy);
}
#[test]
fn cache_copy_keeps_registered_originals_and_file_references_together() {
    check(StorageArea::MediaCache, StorageMigrationMode::Copy);
}
#[test]
fn cache_rebuild_keeps_originals_and_registered_folders_at_the_old_location() {
    check(StorageArea::MediaCache, StorageMigrationMode::Rebuild);
}

fn check(area: StorageArea, mode: StorageMigrationMode) {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let source = if area == StorageArea::RemoteMedia {
        manager.remote_media_root().unwrap()
    } else {
        manager.media_cache_root().unwrap()
    };
    fs::create_dir_all(&source).unwrap();
    let media = source.join("clip.mp4");
    let poster = source.join("cover.jpg");
    fs::write(&media, b"original fixture").unwrap();
    fs::write(&poster, b"cover fixture").unwrap();
    let external = directory.path().join("external.mp4");
    fs::write(&external, b"external fixture").unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: media.to_string_lossy().into_owned(),
            title: None,
        })
        .unwrap();
    let outside = store
        .create_local_project(CreateLocalProjectInput {
            media_path: external.to_string_lossy().into_owned(),
            title: None,
        })
        .unwrap();
    {
        let connection = Connection::open(store.database_path()).unwrap();
        let key = source.to_string_lossy().replace('/', "\\");
        #[cfg(windows)]
        let key = key.to_lowercase();
        connection.execute("INSERT INTO library_roots(id,path,path_key,display_name,created_at_ms,updated_at_ms) VALUES ('folder',?1,?2,'folder',0,0)", params![source.to_string_lossy(), key]).unwrap();
        connection.execute("INSERT INTO collections(id,kind,title,root_id,poster_path,created_at_ms,updated_at_ms) VALUES ('collection','folder','collection','folder',?1,0,0)", [poster.to_string_lossy().as_ref()]).unwrap();
        connection.execute("INSERT INTO library_root_items(root_id,project_id,absolute_order,display_title,relative_path,relative_path_key,created_at_ms,updated_at_ms) VALUES ('folder',?1,0,'clip','clip.mp4','clip.mp4',0,0)", [&project.id]).unwrap();
    }
    let task = prepare(&manager, area, &destination, mode);
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
        StorageMigrationStatus::Completed,
        "{:?}",
        completed.error_message
    );
    let expected = if mode == StorageMigrationMode::Copy {
        &destination
    } else {
        &source
    };
    let restored = store.get_project(&project.id).unwrap();
    assert_eq!(
        Path::new(&restored.media_source.locator),
        expected.join("clip.mp4")
    );
    assert_eq!(
        fs::read(&restored.media_source.locator).unwrap(),
        b"original fixture"
    );
    assert_eq!(
        store.get_project(&outside.id).unwrap().media_source.locator,
        external.to_string_lossy()
    );
    let connection = Connection::open(store.database_path()).unwrap();
    let (folder, relative): (String, String) = connection.query_row("SELECT r.path,i.relative_path FROM library_roots r JOIN library_root_items i ON r.id=i.root_id WHERE i.project_id=?1", [&project.id], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
    assert_eq!(Path::new(&folder), expected);
    let key: String = connection
        .query_row(
            "SELECT path_key FROM library_roots WHERE id='folder'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let expected_key = expected.to_string_lossy().replace('/', "\\");
    #[cfg(windows)]
    let expected_key = expected_key.to_lowercase();
    assert_eq!(key, expected_key);
    assert_eq!(relative, "clip.mp4");
    assert_eq!(
        Path::new(&folder).join(relative),
        Path::new(&restored.media_source.locator)
    );
    let cover: String = connection
        .query_row(
            "SELECT poster_path FROM collections WHERE id='collection'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(Path::new(&cover), expected.join("cover.jpg"));
    assert_eq!(fs::read(cover).unwrap(), b"cover fixture");
    assert_eq!(fs::read(media).unwrap(), b"original fixture");
}
