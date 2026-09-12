use crate::understanding::{self, test_fixture::Fixture, PrepareExplanationTaskInput};
use crate::summary::PromptSelection;
#[test]
fn explanation_material_preparation_excludes_database_migration() {
    let fixture = Fixture::new();
    let task = understanding::prepare_explanation_task_with(&fixture.store,
        PrepareExplanationTaskInput { project_id: fixture.project_id.clone(), handoff_kind: "manual".into(),
            playback_cutoff_ms: 4_500, include_frames: true, prompt_selection: PromptSelection::default() },
        |_, _, output| {
            assert!(crate::storage::database_access::exclusive(fixture.store.database_path()).is_err(),
                "migration must not acquire exclusive access between baseline reads and material writes");
            assert!(crate::project_operations::Deletion::acquire(&fixture.store, &fixture.project_id).is_err(),
                "project deletion must not start during explanation material preparation");
            std::fs::write(output, [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])?;
            Ok(())
        }).unwrap();
    assert!(!task.frames.is_empty());
    assert!(crate::storage::database_access::exclusive(fixture.store.database_path()).is_ok());
}

#[test]
fn manual_result_import_is_rejected_while_project_deletion_owns_admission() {
    let fixture = Fixture::new();
    let task = fixture.prepare();
    let result = fixture.result_path(&task, task.playback_cutoff_ms);
    let deleting = crate::project_operations::Deletion::acquire(&fixture.store, &fixture.project_id).unwrap();
    let input = || understanding::ImportExplanationResultInput { task_id: task.id.clone(), result_path: result.to_string_lossy().into_owned() };
    assert!(understanding::import_explanation_result(&fixture.store, input()).is_err(),
        "manual import must not start while project deletion owns admission");
    assert_eq!(understanding::get_explanation_task(&fixture.store, &task.id).unwrap().status, "awaiting_external_result");
    drop(deleting);
    assert_eq!(understanding::import_explanation_result(&fixture.store, input()).unwrap().task.status, "completed");
}
