use super::*;
use std::fs;
use crate::store::ProjectStore;

struct Fixture {
    _directory: tempfile::TempDir,
    root: PathBuf,
    store: ProjectStore,
    manager: StorageManager,
    intent: CommitIntent,
    original_locator: String,
}

fn fixture() -> Fixture { fixture_for(StorageArea::RemoteMedia, StorageMigrationMode::Copy) }

fn fixture_for(area: StorageArea, mode: StorageMigrationMode) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let media = root.join("remote-media").join("source.mp4");
    fs::create_dir_all(media.parent().unwrap()).unwrap();
    fs::write(&media, b"retained media").unwrap();
    let project = store.create_remote_project(&media, "https://example.com/fixture", "source.mp4", None).unwrap();
    let original_locator = store.get_project(&project.id).unwrap().media_source.locator;
    let poster = root.join("media-cache").join("poster.jpg");
    fs::create_dir_all(poster.parent().unwrap()).unwrap();
    fs::write(&poster, b"retained poster").unwrap();
    Connection::open(store.database_path()).unwrap().execute("UPDATE media_sources SET poster_path=?1", [poster.to_string_lossy().as_ref()]).unwrap();
    let mut task = manager.prepare_migration(super::super::PrepareStorageMigrationInput {
        area, mode,
        destination_directory: destination.to_string_lossy().into_owned(),
    }).unwrap();
    fs::copy(&media, destination.join("source.mp4")).unwrap();
    if mode == StorageMigrationMode::Copy { fs::copy(&poster, destination.join("poster.jpg")).unwrap(); }
    task.status = StorageMigrationStatus::Running;
    {
        let mut runtime = manager.migration.lock().unwrap();
        persist_task(&runtime.path, &task).unwrap();
        runtime.task = Some(task.clone());
    }
    let intent = CommitIntent { version: 1, database: dunce::canonicalize(store.database_path()).unwrap(), revision: 1, task, receipt: None };
    Fixture { _directory: directory, root, store, manager, intent, original_locator }
}

fn stage(f: &Fixture, phase: u8) {
    let mut state = f.manager.state.write().unwrap();
    state.settings.pending_migration_commit = Some(f.intent.clone());
    persist_settings(&state.settings_path, &state.settings).unwrap();
    if phase >= 1 { apply_database(&f.intent).unwrap(); }
    if phase >= 2 {
        if f.intent.task.area == StorageArea::MediaCache { state.settings.media_cache_root = Some(f.intent.task.destination_root.clone()); }
        else { state.settings.remote_media_root = Some(f.intent.task.destination_root.clone()); }
        state.settings.revision = 2;
        persist_settings(&state.settings_path, &state.settings).unwrap();
    }
    drop(state);
    if phase >= 3 {
        let mut runtime = f.manager.migration.lock().unwrap();
        let mut completed = f.intent.task.clone();
        completed.status = StorageMigrationStatus::Completed;
        persist_task(&runtime.path, &completed).unwrap();
        runtime.task = Some(completed);
    }
}

#[test]
fn reopen_resolves_each_commit_boundary_idempotently() {
    for phase in 0..=3 {
        let f = fixture();
        stage(&f, phase);
        assert!(f.manager.remote_media_root().is_err());
        assert!(f.manager.write_state().is_err());
        let root = f.root.clone();
        let id = f.intent.task.id.clone();
        let expected = if phase == 0 { f.original_locator.clone() } else { Path::new(&f.intent.task.destination_root).join("source.mp4").to_string_lossy().into_owned() };
        let original = f.original_locator.clone();
        drop(f.store);
        drop(f.manager);
        let reopened = StorageManager::initialize(&root, root.clone(), None).unwrap();
        let settings = reopened.get_settings().unwrap();
        assert_eq!(settings.revision, if phase == 0 { 1 } else { 2 });
        assert_eq!(reopened.get_migration(&id).unwrap().status, if phase == 0 { StorageMigrationStatus::Interrupted } else { StorageMigrationStatus::Completed });
        assert!(reopened.read_state().unwrap().settings.pending_migration_commit.is_none());
        let connection = Connection::open(root.join("projects/siaovplay.db")).unwrap();
        let locator: String = connection.query_row("SELECT locator FROM media_sources", [], |row| row.get(0)).unwrap();
        assert_eq!(locator, expected);
        assert_eq!(fs::read(&original).unwrap(), b"retained media");
        assert_eq!(fs::read(&locator).unwrap(), b"retained media");
        drop(connection);
        drop(reopened);
        assert_eq!(StorageManager::initialize(&root, root.clone(), None).unwrap().get_settings().unwrap().revision, settings.revision);
    }
}

#[test]
fn rejected_database_transaction_preserves_references_and_releases_intent() {
    let f = fixture();
    let connection = Connection::open(&f.intent.database).unwrap();
    connection.execute_batch("CREATE TRIGGER reject_migration BEFORE UPDATE OF locator ON media_sources BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;").unwrap();
    assert!(f.manager.commit_destination(&f.intent.database, &f.intent.task, receipt_tests::reference(&f)).is_err());
    assert_eq!(f.manager.get_settings().unwrap().revision, 1);
    assert!(f.manager.read_state().unwrap().settings.pending_migration_commit.is_none());
    let locator: String = connection.query_row("SELECT locator FROM media_sources", [], |row| row.get(0)).unwrap();
    assert_eq!(locator, f.original_locator);
}

#[test]
fn uncertain_commit_blocks_mutation_and_read_only_refresh_recovers() {
    let f = fixture();
    stage(&f, 1);
    assert!(f.manager.media_cache_root().is_err());
    assert_eq!(f.manager.get_settings().unwrap().revision, 2);
    assert_eq!(f.manager.get_migration(&f.intent.task.id).unwrap().status, StorageMigrationStatus::Completed);
}

#[test]
fn mismatched_marker_or_revision_never_overwrites_settings() {
    for mismatch in ["marker", "revision", "task", "version"] {
        let f = fixture();
        stage(&f, 1);
        if mismatch == "marker" {
            Connection::open(&f.intent.database).unwrap().execute("UPDATE storage_migration_commits SET intent_json='{}'", []).unwrap();
        } else {
            let mut state = f.manager.state.write().unwrap();
            match mismatch {
                "revision" => state.settings.revision = 99,
                "task" => state.settings.pending_migration_commit.as_mut().unwrap().task.id = "other".to_owned(),
                _ => state.settings.pending_migration_commit.as_mut().unwrap().version = 99,
            }
            persist_settings(&state.settings_path, &state.settings).unwrap();
        }
        let path = f.root.join("storage-settings.json");
        let before = fs::read(&path).unwrap();
        assert!(f.manager.get_settings().is_err());
        assert_eq!(fs::read(path).unwrap(), before);
    }
}

#[test]
fn cancellation_before_commit_preserves_database_and_config() {
    let f = fixture();
    f.manager.cancel_migration(&f.intent.task.id).unwrap();
    assert!(matches!(f.manager.commit_destination(&f.intent.database, &f.intent.task, receipt_tests::reference(&f)), Err(StorageError::MigrationCancelled)));
    assert_eq!(f.manager.get_settings().unwrap().revision, 1);
    let connection = Connection::open(&f.intent.database).unwrap();
    let locator: String = connection.query_row("SELECT locator FROM media_sources", [], |row| row.get(0)).unwrap();
    assert_eq!(locator, f.original_locator);
}

#[test]
fn legacy_settings_upgrade_preserves_revision_and_sets_old_reader_gate() {
    let f = fixture();
    let mut legacy = f.manager.read_state().unwrap().settings.clone();
    legacy.version = 1;
    legacy.revision = 17;
    persist_settings(&f.root.join("storage-settings.json"), &legacy).unwrap();
    let reopened = StorageManager::initialize(&f.root, f.root.clone(), None).unwrap();
    assert_eq!(reopened.get_settings().unwrap().revision, 17);
    let persisted: StorageSettingsFile = serde_json::from_slice(&fs::read(f.root.join("storage-settings.json")).unwrap()).unwrap();
    assert_eq!(persisted.version, super::super::model::settings_version()); // Prior readers reject the new settings version.
}

#[test]
fn cache_copy_and_rebuild_recover_each_commit_boundary() {
    for mode in [StorageMigrationMode::Copy, StorageMigrationMode::Rebuild] {
        for phase in 0..=3 {
            let f = fixture_for(StorageArea::MediaCache, mode);
            stage(&f, phase);
            let root = f.root.clone();
            let old_poster = root.join("media-cache").join("poster.jpg");
            let new_poster = Path::new(&f.intent.task.destination_root).join("poster.jpg");
            drop(f.manager);
            drop(f.store);
            let reopened = StorageManager::initialize(&root, root.clone(), None).unwrap();
            assert_eq!(reopened.get_settings().unwrap().revision, if phase == 0 { 1 } else { 2 });
            let connection = Connection::open(root.join("projects/siaovplay.db")).unwrap();
            let poster: Option<String> = connection.query_row("SELECT poster_path FROM media_sources", [], |row| row.get(0)).unwrap();
            let expected = if phase == 0 { Some(old_poster.to_string_lossy().into_owned()) }
                else if mode == StorageMigrationMode::Copy { Some(new_poster.to_string_lossy().into_owned()) } else { None };
            assert_eq!(poster, expected);
            assert_eq!(fs::read(old_poster).unwrap(), b"retained poster");
            if let Some(path) = poster { assert_eq!(fs::read(path).unwrap(), b"retained poster"); }
            // Settled recovery must not erase a subsequently generated cache reference.
            connection.execute("UPDATE media_sources SET poster_path='later-poster'", []).unwrap();
            reopened.get_settings().unwrap();
            assert_eq!(connection.query_row("SELECT poster_path FROM media_sources", [], |row| row.get::<_, String>(0)).unwrap(), "later-poster");
        }
    }
}

#[path = "migration_commit_receipt_tests.rs"]
mod receipt_tests;
