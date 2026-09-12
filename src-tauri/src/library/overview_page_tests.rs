use crate::library::overview_model::{CollectionOverviewInput, OverviewPageInput};

#[test]
fn collection_overview_search_is_literal_and_binds_even_identical_results() {
    let fixture = Fixture::new();
    let target = fixture.collection("课程 100%_\\ Alpha");
    fixture.collection("课程 100XX Alpha");
    let read = |query: &str, token: Option<String>| {
        fixture.service.collection_overview_page(serde_json::from_value(serde_json::json!({
            "rootLinked": false, "offset": 0, "expectedSnapshotToken": token, "query": query,
        })).unwrap())
    };
    let page = read("%_\\", None).unwrap();
    assert_eq!(page.query, "%_\\");
    assert_eq!(page.page.total_count, 1, "search must filter before counting and paging");
    assert_eq!(page.page.items[0].collection.id, target.id);
    assert!(matches!(read("100%", Some(page.page.snapshot_token)), Err(LibraryError::Conflict(_))),
        "a different query must not reuse a snapshot even when its results are identical");
    assert_eq!(read("aLPHa", None).unwrap().page.total_count, 2);
    assert_eq!(read("不存在", None).unwrap().page.total_count, 0);
}

#[test]
fn collection_search_pages_filter_before_limit_and_preserve_scope() {
    let fixture = Fixture::new();
    for i in 0..26 { fixture.collection(&format!("命中 {i:03}")); fixture.collection(&format!("Other {i:03}")); }
    let root = overview_root(&fixture, 0);
    let linked = fixture.collection("命中 folder");
    fixture.service.store.connect().unwrap().execute("UPDATE collections SET root_id = ?1 WHERE id = ?2", params![root, linked.id]).unwrap();
    let input = CollectionOverviewInput { query: "命中".into(), root_linked: false, page: OverviewPageInput { offset: 0, expected_snapshot_token: None } };
    let first = fixture.service.collection_overview_page(input.clone()).unwrap();
    assert_eq!(first.page.total_count, 26);
    assert_eq!(first.page.items.len(), 24);
    assert!(first.page.items.iter().all(|item| item.collection.title.starts_with("命中")));
    let last = fixture.service.collection_overview_page(CollectionOverviewInput {
        page: OverviewPageInput { offset: 24, expected_snapshot_token: Some(first.page.snapshot_token.clone()) }, ..input.clone()
    }).unwrap();
    assert_eq!(last.page.items.len(), 2);
    assert_eq!(last.page.next_offset, None);
    assert!(last.page.items.iter().all(|item| !first.page.items.iter().any(|old| old.collection.id == item.collection.id)));
    let folder = fixture.service.collection_overview_page(CollectionOverviewInput { root_linked: true, ..input.clone() }).unwrap();
    assert_eq!(folder.page.total_count, 1);
    assert_eq!(folder.page.items[0].collection.id, linked.id);
    let end = fixture.service.collection_overview_page(CollectionOverviewInput {
        page: OverviewPageInput { offset: 26, expected_snapshot_token: Some(first.page.snapshot_token.clone()) }, ..input.clone()
    }).unwrap();
    assert!(end.page.items.is_empty()); assert_eq!(end.page.next_offset, None);
    fixture.service.store.connect().unwrap().execute("UPDATE collections SET title = 'Removed from search' WHERE id = ?1", [&first.page.items[0].collection.id]).unwrap();
    assert!(matches!(fixture.service.collection_overview_page(CollectionOverviewInput {
        page: OverviewPageInput { offset: 24, expected_snapshot_token: Some(first.page.snapshot_token) }, ..input
    }), Err(LibraryError::Conflict(_))));
}

#[test]
fn overview_pages_reject_same_count_reordering() {
    let fixture = Fixture::new();
    let first = fixture.collection("First");
    let second = fixture.collection("Second");
    let input = CollectionOverviewInput { query: String::new(), root_linked: false, page: OverviewPageInput { offset: 0, expected_snapshot_token: None } };
    let initial = fixture.service.collection_overview_page(input.clone()).unwrap();
    let connection = fixture.service.store.connect().unwrap();
    connection.execute("UPDATE collections SET last_opened_at_ms = 9000000000000 WHERE id = ?1", [&first.id]).unwrap();
    let next = CollectionOverviewInput { page: OverviewPageInput { offset: 1, expected_snapshot_token: Some(initial.page.snapshot_token) }, ..input };
    assert!(matches!(fixture.service.collection_overview_page(next), Err(LibraryError::Conflict(_))), "changed order must invalidate the page snapshot");
    assert!(fixture.service.get_collection_detail(&second.id).is_ok());
}

#[test]
fn root_overview_rejects_rename_reordering() {
    let fixture = Fixture::new();
    overview_root(&fixture, 0);
    let second = overview_root(&fixture, 1);
    let initial = fixture.service.root_overview_page(OverviewPageInput { offset: 0, expected_snapshot_token: None }).unwrap();
    fixture.service.store.connect().unwrap().execute("UPDATE library_roots SET display_name = 'A first' WHERE id = ?1", [&second]).unwrap();
    assert!(matches!(fixture.service.root_overview_page(OverviewPageInput { offset: 1, expected_snapshot_token: Some(initial.page.snapshot_token) }), Err(LibraryError::Conflict(_))));
}

#[test]
fn overview_snapshot_counts_and_rows_are_atomic() {
    let fixture = Fixture::new();
    let collection = fixture.collection("Atomic");
    let input = CollectionOverviewInput { query: String::new(), root_linked: false, page: OverviewPageInput { offset: 0, expected_snapshot_token: None } };
    let initial = fixture.service.collection_overview_page(input.clone()).unwrap();
    let page = fixture.service.collection_overview_with_checkpoint(input.clone(), || {
        fixture.service.delete_collection(&collection.id).unwrap();
    }).unwrap();
    assert_eq!(page.page.total_count, 1);
    assert_eq!(page.page.items.len(), 1);
    assert_eq!(page.page.snapshot_token, initial.page.snapshot_token);
    assert_eq!(fixture.service.collection_overview_page(input).unwrap().page.total_count, 0);
    let root = overview_root(&fixture, 0);
    let input = OverviewPageInput { offset: 0, expected_snapshot_token: None };
    let initial = fixture.service.root_overview_page(input.clone()).unwrap();
    let page = fixture.service.root_overview_with_checkpoint(input.clone(), || {
        fixture.service.revoke_library_root(&root).unwrap();
    }).unwrap();
    assert_eq!(page.page.total_count, 1);
    assert_eq!(page.page.items.len(), 1);
    assert_eq!(page.page.snapshot_token, initial.page.snapshot_token);
    assert_eq!(fixture.service.root_overview_page(input).unwrap().page.total_count, 0);
}

#[test]
fn overview_pages_bound_counts_require_valid_cursors_and_bind_scope() {
    let fixture = Fixture::new();
    for i in 0..26 { fixture.collection(&format!("Manual {i}")); overview_root(&fixture, i); }
    let input = OverviewPageInput { offset: 0, expected_snapshot_token: None };
    let first = fixture.service.collection_overview_page(CollectionOverviewInput { query: String::new(), root_linked: false, page: input.clone() }).unwrap();
    let last = OverviewPageInput { offset: 24, expected_snapshot_token: Some(first.page.snapshot_token.clone()) };
    let page = fixture.service.collection_overview_page(CollectionOverviewInput { query: String::new(), root_linked: false, page: last.clone() }).unwrap();
    assert_eq!(first.page.items.len(), 24); assert_eq!(first.page.total_count, 26);
    assert_eq!(page.page.items.len(), 2); assert_eq!(page.page.next_offset, None);
    assert!(matches!(fixture.service.collection_overview_page(CollectionOverviewInput { query: String::new(), root_linked: true, page: last.clone() }), Err(LibraryError::Conflict(_))));
    assert!(matches!(fixture.service.root_overview_page(last), Err(LibraryError::Conflict(_))));
    let roots = fixture.service.root_overview_page(input.clone()).unwrap();
    let page = fixture.service.root_overview_page(OverviewPageInput { offset: 24, expected_snapshot_token: Some(roots.page.snapshot_token) }).unwrap();
    assert_eq!(roots.page.items.len(), 24); assert_eq!(roots.page.total_count, 26);
    assert_eq!(page.page.items.len(), 2); assert_eq!(page.page.next_offset, None);
    for invalid in [OverviewPageInput { offset: 1, expected_snapshot_token: None }, OverviewPageInput { offset: -1, expected_snapshot_token: None },
        OverviewPageInput { offset: 0, expected_snapshot_token: Some("invalid".into()) }, OverviewPageInput { offset: i64::MAX, expected_snapshot_token: None }] {
        assert!(matches!(fixture.service.root_overview_page(invalid.clone()), Err(LibraryError::Validation(_))));
        assert!(matches!(fixture.service.collection_overview_page(CollectionOverviewInput { query: String::new(), root_linked: false, page: invalid }), Err(LibraryError::Validation(_))));
    }
}
