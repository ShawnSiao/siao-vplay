use super::*;
use crate::{domain::CreateLocalProjectInput, project_operations::Operation};
fn setup() -> (tempfile::TempDir, ProjectStore, StorageManager, String) {
    let data = tempfile::tempdir().unwrap();
    let root = data.path().join("app");
    let storage = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let media = data.path().join("source.mp4");
    std::fs::write(&media, b"retain").unwrap();
    let project = store.create_local_project(CreateLocalProjectInput { media_path: media.to_string_lossy().into_owned(), title: None }).unwrap();
    (data, store, storage, project.id)
}
#[test]
fn deletion_waits_for_cancelled_preparation_worker_to_exit() {
    let (data, store, storage, id) = setup();
    let operation = Operation::acquire(&store, &id).unwrap();
    let control = crate::preparation::begin(&uuid::Uuid::new_v4().to_string(), &id).unwrap();
    let worker_store = store.clone(); let worker_id = id.clone();
    let worker = thread::spawn(move || {
        let _operation = operation;
        let deadline = Instant::now() + Duration::from_secs(3);
        while control.cancel.check().is_ok() && Instant::now() < deadline { thread::sleep(Duration::from_millis(1)); }
        let cancelled = control.cancel.check().is_err();
        let retained = worker_store.get_project(&worker_id).is_ok();
        control.finish(crate::preparation::Status::Cancelled);
        cancelled && retained
    });
    let result = run_with_policy(&store, &storage, &id, Policy { timeout_ms: 1000, poll_ms: 1 });
    let stopped_safely = worker.join().unwrap();
    assert!(result.unwrap().deleted);
    assert!(stopped_safely);
    assert!(data.path().join("source.mp4").is_file());
}
#[test]
fn deletion_timeout_retains_project_and_reopens_admission() {
    let (_data, store, storage, id) = setup();
    let operation = Operation::acquire(&store, &id).unwrap();
    let error = run_with_policy(&store, &storage, &id, Policy { timeout_ms: 20, poll_ms: 1 }).unwrap_err();
    assert_eq!(error.code, "project_delete_timeout");
    assert!(store.get_project(&id).is_ok());
    assert!(Operation::acquire(&store, &id).is_ok());
    drop(operation);
    assert!(run_with_policy(&store, &storage, &id, Policy { timeout_ms: 100, poll_ms: 1 }).unwrap().deleted);
}
#[test]
fn deletion_policy_rejects_unbounded_or_invalid_waits() {
    assert!(parse(include_str!("project-deletion-policy.json")).is_ok());
    for source in [r#"{"timeoutMs":0,"pollMs":1}"#, r#"{"timeoutMs":20,"pollMs":0}"#, r#"{"timeoutMs":20,"pollMs":21}"#, r#"{"timeoutMs":120001,"pollMs":1}"#] { assert!(parse(source).is_err()); }
}
