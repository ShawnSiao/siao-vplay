use super::*;
use crate::understanding::{self, test_fixture::Fixture};

#[test]
fn completed_explanation_materials_verify_after_application_data_move() {
    let fixture = Fixture::new();
    let explanation = fixture.prepare();
    let result = fixture.result_path(&explanation, explanation.playback_cutoff_ms);
    understanding::import_explanation_result(
        &fixture.store,
        understanding::ImportExplanationResultInput {
            task_id: explanation.id.clone(),
            result_path: result.to_string_lossy().into(),
        },
    )
    .unwrap();
    let source = fixture.store.data_directory().to_path_buf();
    let original_directory =
        understanding::task_directory(&fixture.store, &explanation.id).unwrap();
    let original_manifest = fs::read(original_directory.join("task.json")).unwrap();
    let original_prompt =
        understanding::read_explanation_prompt(&fixture.store, &explanation.id).unwrap();
    let destination = source.parent().unwrap().join("relocated");
    fs::create_dir(&destination).unwrap();
    let manager = StorageManager::initialize(&source, source.clone(), None).unwrap();
    let task = prepare(
        &manager,
        StorageArea::AppData,
        &destination,
        StorageMigrationMode::Copy,
    );
    manager
        .start_migration(
            fixture.store.database_path().to_path_buf(),
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
    drop(manager);
    let restarted = StorageManager::initialize(&source, source.clone(), None).unwrap();
    let store = ProjectStore::open(
        restarted
            .app_data_root()
            .unwrap()
            .join("projects/siaovplay.db"),
    )
    .unwrap();
    let restored = understanding::get_explanation_task(&store, &explanation.id).unwrap();
    assert_eq!(restored.status, "completed");
    let directory = understanding::task_directory(&store, &explanation.id).unwrap();
    assert!(directory.starts_with(&destination));
    assert_eq!(
        fs::read(directory.join("task.json")).unwrap(),
        original_manifest
    );
    understanding::verify_task_package(&store, &restored, &directory).unwrap();
    assert_eq!(
        understanding::read_explanation_prompt(&store, &explanation.id).unwrap(),
        original_prompt
    );
    assert_eq!(restored.frames.len(), explanation.frames.len());
    assert!(!restored.frames.is_empty());
    for (frame, original) in restored.frames.iter().zip(&explanation.frames) {
        assert!(Path::new(&frame.path).starts_with(&destination));
        assert_eq!(
            crate::agent_task_files::hash_file(Path::new(&frame.path)).unwrap(),
            original.sha256
        );
    }
    assert_eq!(
        fs::read(original_directory.join("task.json")).unwrap(),
        original_manifest
    );
}
