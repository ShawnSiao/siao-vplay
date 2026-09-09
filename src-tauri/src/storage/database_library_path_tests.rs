use super::*;
use crate::store::ProjectStore;

fn root(connection: &Connection, id: &str, path: &Path) {
    let key = path.to_string_lossy().replace('/', "\\");
    #[cfg(windows)]
    let key = key.to_lowercase();
    connection.execute("INSERT INTO library_roots(id,path,path_key,display_name,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?1,0,0)", params![id, path.to_string_lossy(), key]).unwrap();
}

#[test]
fn app_data_relocation_updates_library_roots_and_preserves_external_roots() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source");
    let destination = directory.path().join("destination");
    let external = directory.path().join("external");
    let store = ProjectStore::open(source.join("projects/siaovplay.db")).unwrap();
    let connection = Connection::open(store.database_path()).unwrap();
    root(&connection, "internal", &source.join("Movies"));
    root(&connection, "external", &external);
    let poster = source.join("media-cache/poster.jpg");
    connection.execute("INSERT INTO collections(id,kind,title,root_id,poster_path,created_at_ms,updated_at_ms) VALUES ('folder','folder','folder','internal',?1,0,0)", [poster.to_string_lossy().as_ref()]).unwrap();
    rewrite_managed_paths(
        store.database_path(),
        StorageArea::AppData,
        &source,
        &destination,
    )
    .unwrap();
    let (path, key): (String, String) = connection
        .query_row(
            "SELECT path,path_key FROM library_roots WHERE id='internal'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let expected = destination.join("Movies");
    assert_eq!(Path::new(&path), expected);
    let expected_key = expected.to_string_lossy().replace('/', "\\");
    #[cfg(windows)]
    let expected_key = expected_key.to_lowercase();
    assert_eq!(key, expected_key);
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
    assert_eq!(
        connection
            .query_row(
                "SELECT poster_path FROM collections WHERE id='folder'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        destination.join("media-cache/poster.jpg").to_string_lossy()
    );
    // Reverse the path transform on the isolated DB; stable IDs and links survive.
    rewrite_managed_paths(
        store.database_path(),
        StorageArea::AppData,
        &destination,
        &source,
    )
    .unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT path FROM library_roots WHERE id='internal'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        source.join("Movies").to_string_lossy()
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT root_id FROM collections WHERE id='folder'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "internal"
    );
}

#[test]
fn root_identity_collision_rolls_back_all_path_rewrites() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source");
    let destination = directory.path().join("destination");
    let store = ProjectStore::open(source.join("projects/siaovplay.db")).unwrap();
    let connection = Connection::open(store.database_path()).unwrap();
    root(&connection, "moving", &source.join("Movies"));
    root(&connection, "existing", &destination.join("Movies"));
    let poster = source
        .join("media-cache/poster.jpg")
        .to_string_lossy()
        .into_owned();
    connection.execute("INSERT INTO collections(id,kind,title,poster_path,created_at_ms,updated_at_ms) VALUES ('manual','manual','manual',?1,0,0)", [&poster]).unwrap();
    assert!(
        rewrite_managed_paths(
            store.database_path(),
            StorageArea::AppData,
            &source,
            &destination
        )
        .is_err()
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT poster_path FROM collections WHERE id='manual'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        poster
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT path FROM library_roots WHERE id='moving'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        source.join("Movies").to_string_lossy()
    );
}
