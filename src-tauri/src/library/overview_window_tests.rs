fn overview_root(fixture: &Fixture, index: usize) -> String {
    let id = Uuid::new_v4().to_string();
    let path = fixture.temporary.path().join(format!("root-{index:03}"));
    fs::create_dir(&path).unwrap();
    let path = path.to_string_lossy().into_owned();
    let connection = fixture.service.store.connect().unwrap();
    LibraryRepository::new(&connection).insert_library_root(&NewLibraryRoot {
        id: &id, path: &path, path_key: &path, display_name: &format!("Folder {index:03}"), timestamp: 1,
    }).unwrap();
    id
}

#[test]
fn overview_windows_bound_rows_and_preserve_order() {
    let fixture = Fixture::new();
    for index in 0..27 {
        let root = overview_root(&fixture, index);
        let collection = fixture.collection(&format!("Collection {index:03}"));
        fixture.service.store.connect().unwrap().execute("UPDATE collections SET root_id = ?1 WHERE id = ?2", params![root, collection.id]).unwrap();
    }
    let connection = fixture.service.store.connect().unwrap();
    let repository = LibraryRepository::new(&connection);
    let collections = repository.list_collection_summaries().unwrap();
    assert_eq!(repository.list_collection_summary_window(7, 3, None).unwrap(), collections[3..10]);
    let roots = repository.list_roots().unwrap();
    assert_eq!(repository.list_root_window(7, 3).unwrap(), roots[3..10]);
    assert!(repository.list_root_window(7, 27).unwrap().is_empty());
    assert!(repository.list_collection_summary_window(7, 27, None).unwrap().is_empty());
    assert!(repository.list_root_window(0, 0).unwrap().is_empty());
    assert!(repository.list_collection_summary_window(0, 0, None).unwrap().is_empty());
    assert!(repository.list_root_window(7, -1).is_err());
    assert!(repository.list_collection_summary_window(-2, 0, None).is_err());
}

#[test]
fn overview_filters_and_aggregate_fields_preserve_recovery_context() {
    let fixture = Fixture::new();
    let orphan = overview_root(&fixture, 0);
    let linked = fixture.imported_collection("Folder collection");
    let manual = fixture.collection("Manual collection");
    let first = fixture.project("first.mp4");
    let second = fixture.project("second.mp4");
    fixture.add_imported(&linked, &first, 0);
    fixture.add_imported(&linked, &second, 1);
    fixture.add(&manual, &first, 1, 1, 0);
    fixture.service.set_watch_later(&first.id, true).unwrap();
    let connection = fixture.service.store.connect().unwrap();
    connection.execute("UPDATE playback_states SET completed_at_ms = 1, duration_ms = 3000 WHERE project_id = ?1", [&first.id]).unwrap();
    let repository = LibraryRepository::new(&connection);
    let folder_page = repository.list_collection_summary_window(24, 0, Some(true)).unwrap();
    assert_eq!(folder_page.len(), 1);
    assert_eq!(folder_page[0].collection.id, linked.id);
    assert_eq!(folder_page[0].item_count, 2);
    assert_eq!(folder_page[0].season_count, 1);
    assert_eq!(folder_page[0].watched_count, 1);
    assert_eq!(folder_page[0].total_duration_ms, Some(3000));
    let manual_page = repository.list_collection_summary_window(24, 0, Some(false)).unwrap();
    assert_eq!(manual_page.len(), 1);
    assert_eq!(manual_page[0].collection.id, manual.id);
    let all = repository.list_collection_summaries().unwrap();
    assert_eq!(all.last().unwrap().collection.system_key.as_deref(), Some("watch_later"));
    let roots = repository.list_root_window(24, 0).unwrap();
    assert_eq!(roots.iter().find(|root| root.id == orphan).unwrap().status, LibraryRootStatus::Orphaned);
    let root = roots.iter().find(|root| Some(&root.id) == linked.root_id.as_ref()).unwrap();
    assert_eq!(root.status, LibraryRootStatus::Linked);
    assert_eq!(root.item_count, 2);
    assert_eq!(root.availability, "available");
    connection.execute("UPDATE collections SET root_id = ?1 WHERE id = ?2", params![linked.root_id, manual.id]).unwrap();
    let roots = repository.list_root_window(24, 0).unwrap();
    let root = roots.iter().find(|root| Some(&root.id) == linked.root_id.as_ref()).unwrap();
    assert_eq!(root.status, LibraryRootStatus::Ambiguous);
    assert_eq!(root.item_count, 2, "root items are counted independently of duplicated collection memberships");
    let absent = fixture.temporary.path().join("missing-root").to_string_lossy().into_owned();
    connection.execute("UPDATE library_roots SET path = ?1 WHERE id = ?2", params![absent, orphan]).unwrap();
    assert_eq!(repository.list_root_window(24, 0).unwrap().iter().find(|root| root.id == orphan).unwrap().availability, "offline");
}

#[test]
fn overview_windows_decode_only_selected_collections_with_stable_ties() {
    let fixture = Fixture::new();
    let beta = fixture.collection("beta");
    let a = fixture.collection("Alpha");
    let b = fixture.collection("alpha");
    let connection = fixture.service.store.connect().unwrap();
    connection.execute("UPDATE collections SET updated_at_ms = 1, last_opened_at_ms = NULL", []).unwrap();
    let repository = LibraryRepository::new(&connection);
    let mut first_ids = vec![a.id, b.id]; first_ids.sort();
    let rows = repository.list_collection_summary_window(2, 0, None).unwrap();
    assert_eq!(rows.iter().map(|row| row.collection.id.clone()).collect::<Vec<_>>(), first_ids);
    connection.execute_batch("PRAGMA ignore_check_constraints = ON").unwrap();
    connection.execute("UPDATE collections SET sort_mode = 'invalid' WHERE id = ?1", [&beta.id]).unwrap();
    assert!(repository.list_collection_summary_window(2, 0, None).is_ok(), "off-page records must not be decoded");
    assert!(repository.list_collection_summaries().is_err(), "fixture must expose the malformed off-page row");
}
