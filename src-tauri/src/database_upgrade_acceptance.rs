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
    drop(backup);
    drop(migrated);
    drop(store);
    ProjectStore::open(&path).unwrap();
    assert!(
        before == assets(&Connection::open(&path).unwrap()),
        "assets changed on reopen"
    );
    println!("schema {version} -> 21: assets, backup, integrity and reopen verified");
}
