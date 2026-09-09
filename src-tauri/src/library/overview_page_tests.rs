use crate::library::overview_model::{CollectionOverviewInput, OverviewPageInput};

#[test]
fn overview_pages_reject_same_count_reordering() {
    let fixture = Fixture::new();
    let first = fixture.collection("First");
    let second = fixture.collection("Second");
    let input = CollectionOverviewInput { root_linked: false, page: OverviewPageInput { offset: 0, expected_snapshot_token: None } };
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
    let input = CollectionOverviewInput { root_linked: false, page: OverviewPageInput { offset: 0, expected_snapshot_token: None } };
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
    let first = fixture.service.collection_overview_page(CollectionOverviewInput { root_linked: false, page: input.clone() }).unwrap();
    let last = OverviewPageInput { offset: 24, expected_snapshot_token: Some(first.page.snapshot_token.clone()) };
    let page = fixture.service.collection_overview_page(CollectionOverviewInput { root_linked: false, page: last.clone() }).unwrap();
    assert_eq!(first.page.items.len(), 24); assert_eq!(first.page.total_count, 26);
    assert_eq!(page.page.items.len(), 2); assert_eq!(page.page.next_offset, None);
    assert!(matches!(fixture.service.collection_overview_page(CollectionOverviewInput { root_linked: true, page: last.clone() }), Err(LibraryError::Conflict(_))));
    assert!(matches!(fixture.service.root_overview_page(last), Err(LibraryError::Conflict(_))));
    let roots = fixture.service.root_overview_page(input.clone()).unwrap();
    let page = fixture.service.root_overview_page(OverviewPageInput { offset: 24, expected_snapshot_token: Some(roots.page.snapshot_token) }).unwrap();
    assert_eq!(roots.page.items.len(), 24); assert_eq!(roots.page.total_count, 26);
    assert_eq!(page.page.items.len(), 2); assert_eq!(page.page.next_offset, None);
    for invalid in [OverviewPageInput { offset: 1, expected_snapshot_token: None }, OverviewPageInput { offset: -1, expected_snapshot_token: None },
        OverviewPageInput { offset: 0, expected_snapshot_token: Some("invalid".into()) }, OverviewPageInput { offset: i64::MAX, expected_snapshot_token: None }] {
        assert!(matches!(fixture.service.root_overview_page(invalid.clone()), Err(LibraryError::Validation(_))));
        assert!(matches!(fixture.service.collection_overview_page(CollectionOverviewInput { root_linked: false, page: invalid }), Err(LibraryError::Validation(_))));
    }
}
