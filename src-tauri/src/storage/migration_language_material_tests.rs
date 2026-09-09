use super::*;
use crate::{
    learning,
    translation::{self, fixture::TranslationFixture},
};

#[test]
fn translation_and_learning_packages_verify_after_relocation() {
    let fixture = TranslationFixture::new();
    let translation = fixture.prepare_manual_for("ja", "zh-cn");
    let result = fixture.write_result("translated.json", &fixture.result_value(&translation));
    translation::import_translation_result(
        &fixture.store,
        translation::ImportTranslationResultInput {
            task_id: translation.id.clone(),
            result_path: result.to_string_lossy().into(),
        },
    )
    .unwrap();
    let learning = learning::prepare_learning_task(
        &fixture.store,
        learning::PrepareLearningTaskInput {
            project_id: fixture.project_id.clone(),
            handoff_kind: "manual".into(),
            source_segment_id: fixture.segment_ids[0].clone(),
            selected_text: "明日".into(),
            selection_kind: "word".into(),
            playback_position_ms: 500,
        },
    )
    .unwrap();
    // Seed a terminal failure, permitting migration without dispatching the manual task.
    fixture
        .store
        .connect()
        .unwrap()
        .execute(
            "UPDATE learning_tasks SET status='failed', stage='failed' WHERE id=?1",
            [&learning.id],
        )
        .unwrap();
    let translation_prompt =
        translation::read_translation_prompt(&fixture.store, &translation.id).unwrap();
    let learning_prompt = learning::read_learning_prompt(&fixture.store, &learning.id).unwrap();
    let source = fixture.store.data_directory().to_path_buf();
    let manifests: Vec<_> = [&translation.id, &learning.id]
        .iter()
        .map(|id| fs::read(source.join("agent-tasks").join(id).join("task.json")).unwrap())
        .collect();
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
    for (id, manifest) in [&translation.id, &learning.id].iter().zip(manifests) {
        assert_eq!(
            fs::read(destination.join("agent-tasks").join(id).join("task.json")).unwrap(),
            manifest
        );
        assert_eq!(
            fs::read(source.join("agent-tasks").join(id).join("task.json")).unwrap(),
            manifest
        );
    }
    let translation_directory = translation::task_directory(&store, &translation.id).unwrap();
    assert!(translation_directory.starts_with(&destination));
    translation::verify_task_package(&store, &translation.id, &translation_directory).unwrap();
    assert_eq!(
        translation::read_translation_prompt(&store, &translation.id).unwrap(),
        translation_prompt
    );
    let restored = learning::get_learning_task(&store, &learning.id).unwrap();
    assert_eq!(restored.status, "failed");
    assert_eq!(restored.source_segment_id, learning.source_segment_id);
    assert_eq!(
        restored.translation_version_id,
        learning.translation_version_id
    );
    let learning_directory = learning::task_directory(&store, &learning.id).unwrap();
    assert!(learning_directory.starts_with(&destination));
    learning::verify_task_package(&store, &restored, &learning_directory).unwrap();
    assert_eq!(
        learning::read_learning_prompt(&store, &learning.id).unwrap(),
        learning_prompt
    );
}
