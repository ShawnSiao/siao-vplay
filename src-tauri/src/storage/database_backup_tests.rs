use super::*;
use std::cell::Cell;

fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.db");
    let destination = directory.path().join("destination.db");
    let connection = Connection::open(&source).unwrap();
    connection.execute_batch("CREATE TABLE samples (id INTEGER PRIMARY KEY, payload BLOB); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2048) INSERT INTO samples SELECT x, zeroblob(4096) FROM n;").unwrap();
    drop(connection);
    (directory, source, destination)
}

#[test]
fn cancelled_backup_does_not_remove_existing_destination() {
    let (_directory, source, destination) = fixture();
    fs::write(&destination, b"retained destination").unwrap();
    assert!(matches!(backup_database(&source, &destination, || true), Err(StorageError::MigrationCancelled)));
    assert_eq!(fs::read(destination).unwrap(), b"retained destination");
}

#[test]
fn backup_stops_between_batches_and_can_retry_without_source_changes() {
    let (_directory, source, destination) = fixture();
    let original = fs::read(&source).unwrap();
    let checks = Cell::new(0);
    let result = backup_database(&source, &destination, || { checks.set(checks.get() + 1); checks.get() >= 3 });
    assert!(matches!(result, Err(StorageError::MigrationCancelled)));
    assert_eq!(fs::read(&source).unwrap(), original);
    backup_database(&source, &destination, || false).unwrap();
    let copy = Connection::open(destination).unwrap();
    assert_eq!(copy.query_row("SELECT COUNT(*) FROM samples", [], |row| row.get::<_, i64>(0)).unwrap(), 2048);
    assert_eq!(fs::read(source).unwrap(), original);
}

#[test]
fn locked_source_backup_observes_cancellation() {
    let (_directory, source, destination) = fixture();
    let writer = Connection::open(&source).unwrap();
    writer.execute_batch("BEGIN EXCLUSIVE; UPDATE samples SET payload=zeroblob(4096) WHERE id=1;").unwrap();
    let checks = Cell::new(0);
    let result = backup_database(&source, &destination, || { checks.set(checks.get() + 1); checks.get() >= 3 });
    assert!(matches!(result, Err(StorageError::MigrationCancelled)));
    writer.execute_batch("ROLLBACK;").unwrap();
    backup_database(&source, &destination, || false).unwrap();
    verify_database(&source).unwrap();
    verify_database(&destination).unwrap();
}
