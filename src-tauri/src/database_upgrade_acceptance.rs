use crate::store::ProjectStore;
use rusqlite::{Connection, OpenFlags, backup::Backup, types::Value};

fn assets(database: &Connection) -> Vec<Vec<Vec<Value>>> {
    [
        "projects",
        "subtitle_versions",
        "subtitle_segments",
        "learning_cards",
        "playback_states",
    ]
    .iter()
    .map(|table| {
        let mut statement = database
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .unwrap();
        let columns = statement.column_count();
        statement
            .query_map([], |row| (0..columns).map(|index| row.get(index)).collect())
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    })
    .collect()
}

#[test]
#[ignore = "requires an explicitly selected old database; migration runs only on a temporary snapshot"]
fn real_old_database_snapshot_preserves_assets_and_backup() {
    let source_path = std::env::var_os("SIAOVPLAY_UPGRADE_SOURCE").expect("select an old database");
    let source =
        Connection::open_with_flags(source_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("snapshot.db");
    let mut snapshot = Connection::open(&path).unwrap();
    Backup::new(&source, &mut snapshot)
        .unwrap()
        .run_to_completion(128, std::time::Duration::from_millis(10), None)
        .unwrap();
    drop(source);
    let before = assets(&snapshot);
    let version = super::check_version(&snapshot, 21).unwrap();
    assert!(
        (1..21).contains(&version),
        "requires a genuinely older schema"
    );
    drop(snapshot);
    let store = ProjectStore::open(&path).unwrap();
    let migrated = Connection::open(&path).unwrap();
    assert!(
        before == assets(&migrated),
        "user assets changed during upgrade"
    );
    assert_eq!(super::check_version(&migrated, 21).unwrap(), 21);
    let integrity: String = migrated
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    assert!(
        !migrated
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap()
    );
    let backups: Vec<_> = std::fs::read_dir(directory.path().join("upgrade-backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(backups.len(), 1);
    let backup =
        Connection::open_with_flags(&backups[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(super::check_version(&backup, 21).unwrap(), version);
    assert!(
        before == assets(&backup),
        "backup assets differ from pre-upgrade snapshot"
    );
    // Exercise recovery from the retained backup, not from the upgraded database.
    let recovery_directory = directory.path().join("recovered");
    std::fs::create_dir(&recovery_directory).unwrap();
    let recovered_path = recovery_directory.join("projects.db");
    let mut recovered = Connection::open(&recovered_path).unwrap();
    Backup::new(&backup, &mut recovered)
        .unwrap()
        .run_to_completion(128, std::time::Duration::from_millis(10), None)
        .unwrap();
    drop(recovered);
    let recovered_store = ProjectStore::open(&recovered_path).unwrap();
    let recovered = Connection::open(&recovered_path).unwrap();
    assert_eq!(super::check_version(&recovered, 21).unwrap(), 21);
    assert!(before == assets(&recovered), "restored assets differ");
    let project_ids: Vec<String> = recovered
        .prepare("SELECT id FROM projects")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    for project_id in project_ids {
        assert!(
            recovered_store.get_project(&project_id).is_ok(),
            "restored project cannot load"
        );
    }
    drop(recovered);
    drop(recovered_store);
    drop(backup);
    drop(migrated);
    drop(store);
    ProjectStore::open(&path).unwrap();
    assert!(
        before == assets(&Connection::open(&path).unwrap()),
        "assets changed on reopen"
    );
    println!(
        "schema {version} -> 21: assets, backup recovery, project loading, integrity and reopen verified"
    );
}
