use super::{
    task_repository::SummaryTaskRepository, test_support::prepared_summary, verified_materials,
};
use crate::{storage::*, store::ProjectStore};
use std::{
    fs,
    path::Path,
    thread,
    time::{Duration, Instant},
};

#[test]
fn failed_summary_materials_remain_verified_after_data_migration() {
    let (_temporary, store, task) = prepared_summary();
    let repository = SummaryTaskRepository::new(&store);
    repository
        .fail(
            &task.id,
            "fixture_interruption",
            "isolated recovery fixture",
        )
        .unwrap();
    let original_manifest =
        fs::read(Path::new(&task.materials_directory).join("manifest.json")).unwrap();
    let source = store.data_directory().to_path_buf();
    let destination = source.parent().unwrap().join("relocated");
    fs::create_dir(&destination).unwrap();
    let manager = StorageManager::initialize(&source, source.clone(), None).unwrap();
    let migration = manager
        .prepare_migration(PrepareStorageMigrationInput {
            area: StorageArea::AppData,
            destination_directory: destination.to_string_lossy().into(),
            mode: StorageMigrationMode::Copy,
        })
        .unwrap();
    manager
        .start_migration(
            store.database_path().to_path_buf(),
            StartStorageMigrationInput {
                task_id: migration.id.clone(),
                confirmed: true,
            },
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let current = manager.get_migration(&migration.id).unwrap();
        if !matches!(
            current.status,
            StorageMigrationStatus::Prepared | StorageMigrationStatus::Running
        ) {
            assert_eq!(
                current.status,
                StorageMigrationStatus::RestartRequired,
                "{:?}",
                current.error_message
            );
            break;
        }
        assert!(Instant::now() < deadline, "migration did not finish");
        thread::sleep(Duration::from_millis(10));
    }
    drop(manager);
    let restarted = StorageManager::initialize(&source, source.clone(), None).unwrap();
    let moved_store = ProjectStore::open(
        restarted
            .app_data_root()
            .unwrap()
            .join("projects/siaovplay.db"),
    )
    .unwrap();
    let moved = SummaryTaskRepository::new(&moved_store)
        .get(&task.id)
        .unwrap();
    assert_eq!(moved.status, "failed");
    assert!(Path::new(&moved.materials_directory).starts_with(&destination));
    assert_eq!(
        fs::read(Path::new(&moved.materials_directory).join("manifest.json")).unwrap(),
        original_manifest
    );
    let materials = verified_materials::load(&moved_store, &moved).unwrap();
    assert_eq!(materials.segments.len(), 1);
    assert_eq!(materials.segments[0].text, "past");
    assert!(materials.frames.is_empty());
    assert_eq!(
        moved.material_manifest_sha256,
        task.material_manifest_sha256
    );
    assert_eq!(
        fs::read(Path::new(&task.materials_directory).join("manifest.json")).unwrap(),
        original_manifest
    );
}
