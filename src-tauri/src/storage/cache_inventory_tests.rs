use super::*;
use crate::store::ProjectStore;

#[test]
fn removes_a_recorded_playback_proxy() {
    let (_directory, store, root, project) = fixture();
    let path = root.join(&project).join("playback-aaaaaaaaaaaaaaaa.mp4");
    fs::write(&path, b"proxy").unwrap();
    let connection = Connection::open(store.database_path()).unwrap();
    connection.execute("INSERT INTO media_artifacts(id, project_id, source_media_id, kind, status, path, source_sha256, profile, created_at_ms, updated_at_ms) SELECT 'artifact', project_id, id, 'playback_proxy', 'completed', ?1, ?2, 'test', 1, 1 FROM media_sources", rusqlite::params![path.to_string_lossy(), "a".repeat(64)]).unwrap();
    assert_eq!(
        clear_recorded_cache(store.database_path(), &root).unwrap(),
        5
    );
    assert!(!path.exists());
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM media_artifacts", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[cfg(windows)]
#[test]
fn never_follows_a_project_directory_junction() {
    let (directory, store, root, project) = fixture();
    let target = directory.path().join("external");
    fs::create_dir(&target).unwrap();
    let sentinel = target.join("poster-aaaaaaaaaaaaaaaa.jpg");
    fs::write(&sentinel, b"retain").unwrap();
    let project_directory = root.join(project);
    fs::remove_dir(&project_directory).unwrap();
    let output = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&project_directory)
        .arg(&target)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    record_poster(
        &store,
        &project_directory.join("poster-aaaaaaaaaaaaaaaa.jpg"),
    );
    let result = clear_recorded_cache(store.database_path(), &root);
    // Remove only the junction itself, never recurse into its target.
    fs::remove_dir(&project_directory).unwrap();
    assert_eq!(result.unwrap(), 0);
    assert_eq!(fs::read(sentinel).unwrap(), b"retain");
    assert!(poster(&store).is_some());
}

fn fixture() -> (tempfile::TempDir, ProjectStore, PathBuf, String) {
    let directory = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(directory.path().join("projects/siaovplay.db")).unwrap();
    let source = directory.path().join("source.mp4");
    fs::write(&source, b"source").unwrap();
    let project = store
        .create_remote_project(&source, "https://example.com/fixture", "source.mp4", None)
        .unwrap();
    let root = directory.path().join("cache");
    fs::create_dir_all(root.join(&project.id)).unwrap();
    (directory, store, root, project.id)
}

fn record_poster(store: &ProjectStore, path: &Path) {
    Connection::open(store.database_path())
        .unwrap()
        .execute(
            "UPDATE media_sources SET poster_path = ?1, source_sha256 = ?2",
            rusqlite::params![path.to_string_lossy(), "a".repeat(64)],
        )
        .unwrap();
}

fn poster(store: &ProjectStore) -> Option<String> {
    Connection::open(store.database_path())
        .unwrap()
        .query_row("SELECT poster_path FROM media_sources LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn removes_registered_poster_but_preserves_unknown_siblings_and_directories() {
    let (_directory, store, root, project) = fixture();
    let path = root.join(&project).join("poster-aaaaaaaaaaaaaaaa.jpg");
    fs::write(&path, b"poster").unwrap();
    record_poster(&store, &path);
    let unknown = root.join(&project).join("personal.mp4");
    fs::write(&unknown, b"user content").unwrap();
    assert_eq!(
        clear_recorded_cache(store.database_path(), &root).unwrap(),
        6
    );
    assert!(!path.exists());
    assert_eq!(poster(&store), None);
    assert_eq!(fs::read(unknown).unwrap(), b"user content");
    assert!(root.join(project).is_dir());
}

#[test]
fn preserves_outside_and_unrecognized_registered_paths() {
    let (directory, store, root, project) = fixture();
    for path in [
        directory.path().join("poster-aaaaaaaaaaaaaaaa.jpg"),
        root.join(project).join("notes.txt"),
    ] {
        fs::write(&path, b"retain").unwrap();
        record_poster(&store, &path);
        assert_eq!(
            clear_recorded_cache(store.database_path(), &root).unwrap(),
            0
        );
        assert_eq!(fs::read(&path).unwrap(), b"retain");
        assert_eq!(poster(&store).as_deref(), path.to_str());
    }
}

#[test]
fn never_deletes_a_path_also_used_as_original_media() {
    let (_directory, store, root, project) = fixture();
    let path = root.join(project).join("poster-aaaaaaaaaaaaaaaa.jpg");
    fs::write(&path, b"original").unwrap();
    record_poster(&store, &path);
    Connection::open(store.database_path())
        .unwrap()
        .execute(
            "UPDATE media_sources SET locator = ?1",
            [path.to_string_lossy().as_ref()],
        )
        .unwrap();
    assert_eq!(
        clear_recorded_cache(store.database_path(), &root).unwrap(),
        0
    );
    assert_eq!(fs::read(&path).unwrap(), b"original");
    assert!(poster(&store).is_some());
}

#[test]
fn a_directory_at_a_recorded_file_path_is_not_removed() {
    let (_directory, store, root, project) = fixture();
    let path = root.join(project).join("poster-aaaaaaaaaaaaaaaa.jpg");
    fs::create_dir(&path).unwrap();
    fs::write(path.join("sentinel"), b"retain").unwrap();
    record_poster(&store, &path);
    assert_eq!(
        clear_recorded_cache(store.database_path(), &root).unwrap(),
        0
    );
    assert_eq!(fs::read(path.join("sentinel")).unwrap(), b"retain");
}
