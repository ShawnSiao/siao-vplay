use super::*;
use crate::domain::CreateLocalProjectInput;
#[test]
fn closing_blocks_new_work_while_admitted_operation_can_finish() {
    let data = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(data.path().join("projects/siaovplay.db")).unwrap();
    let create = |name: &str| {
        let path = data.path().join(name);
        std::fs::write(&path, b"retain").unwrap();
        store.create_local_project(CreateLocalProjectInput { media_path: path.to_string_lossy().into_owned(), title: None }).unwrap()
    };
    let first = create("first.mp4");
    let second = create("second.mp4");
    let operation = Operation::acquire(&store, &first.id).unwrap();
    let closing = Deletion::begin(&store, &first.id).expect("closing must begin before existing work finishes");
    assert!(Operation::acquire(&store, &first.id).is_err());
    assert!(Deletion::begin(&store, &first.id).is_err());
    assert!(Operation::acquire(&store, &second.id).is_ok());
    assert!(operation.ensure_project(&store, &first.id).is_ok());
    assert!(store.get_project(&first.id).is_ok());
    assert!(!closing.is_idle().unwrap());
    assert!(store.delete_project_with_permit(&first.id, data.path(), &closing).is_err());
    assert!(store.get_project(&first.id).is_ok());
    drop(closing);
    assert!(Operation::acquire(&store, &first.id).is_ok(), "aborted deletion must reopen admission");
    let closing = Deletion::begin(&store, &first.id).unwrap();
    drop(operation);
    assert!(closing.is_idle().unwrap());
    assert!(store.delete_project_with_permit(&second.id, data.path(), &closing).is_err());
    assert!(store.delete_project_with_permit(&first.id, data.path(), &closing).unwrap().deleted);
    assert!(store.get_project(&second.id).is_ok());
    assert!(data.path().join("first.mp4").is_file());
}
