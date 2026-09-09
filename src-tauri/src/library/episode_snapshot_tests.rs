#[test]
fn episode_page_rejects_reordering_even_when_count_is_unchanged() {
    let fixture = Fixture::new();
    let collection = fixture.collection("snapshot-order");
    let first = fixture.project("first.mp4");
    let second = fixture.project("second.mp4");
    fixture.add(&collection, &first, 1, 1, 0);
    fixture.add(&collection, &second, 1, 2, 1);
    let input = crate::library::ListCollectionEpisodePageInput { collection_id: collection.id.clone(), season_number: None,
        offset: 0, expected_snapshot_token: None };
    let page = fixture.service.list_collection_episode_page(input.clone()).unwrap();
    let next = crate::library::ListCollectionEpisodePageInput { offset: 1,
        expected_snapshot_token: Some(page.snapshot_token.clone()), ..input.clone() };
    assert!(fixture.service.list_collection_episode_page(next.clone()).is_ok());
    let connection = fixture.service.store.connect().unwrap();
    connection.execute("UPDATE playback_states SET position_ms = 4000 WHERE project_id = ?1", [&first.id]).unwrap();
    assert_eq!(fixture.service.list_collection_episode_page(next.clone()).unwrap().snapshot_token, page.snapshot_token);
    assert!(fixture.service.list_collection_episode_page(crate::library::ListCollectionEpisodePageInput {
        offset: 1, ..input.clone()
    }).is_err(), "continuations require an ordering snapshot");
    assert!(matches!(fixture.service.list_collection_episode_page(crate::library::ListCollectionEpisodePageInput {
        season_number: Some(1), ..next.clone()
    }), Err(LibraryError::Conflict(_))));
    connection.execute("UPDATE collection_items SET absolute_order = 1 - absolute_order WHERE collection_id = ?1", [&collection.id]).unwrap();
    assert!(matches!(fixture.service.list_collection_episode_page(next), Err(LibraryError::Conflict(_))));
    let fresh = fixture.service.list_collection_episode_page(input).unwrap();
    assert_ne!(fresh.snapshot_token, page.snapshot_token);
    assert_eq!(fresh.items[0].project_id, second.id);
    fixture.service.remove_project_from_collection(&collection.id, &first.id).unwrap();
    assert!(matches!(fixture.service.list_collection_episode_page(crate::library::ListCollectionEpisodePageInput {
        collection_id: collection.id, season_number: None, offset: 1, expected_snapshot_token: Some(fresh.snapshot_token),
    }), Err(LibraryError::Conflict(_))));
}
