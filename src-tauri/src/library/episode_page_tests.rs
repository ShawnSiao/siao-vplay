#[test]
fn episode_windows_preserve_order_without_gaps_or_duplicates() {
    let fixture = Fixture::new();
    let collection = fixture.collection("paged");
    for index in 0..27 {
        let project = fixture.project(&format!("page-{index:02}.mp4"));
        fixture.add(&collection, &project, index % 2 + 1, index / 2 + 1, 27 - index);
    }
    let connection = fixture.service.store.connect().unwrap();
    let repository = LibraryRepository::new(&connection);
    for sort_mode in ["manual", "episode"] {
        connection.execute("UPDATE collections SET sort_mode = ?1 WHERE id = ?2", rusqlite::params![sort_mode, collection.id]).unwrap();
        for season in [None, Some(1), Some(2), Some(99)] {
            let full = repository.list_collection_episodes(&collection.id, season).unwrap();
            let mut joined = Vec::new();
            for offset in (0..30).step_by(7) {
                let page = repository.list_collection_episode_window(&collection.id, season, 7, offset).unwrap();
                assert!(page.len() <= 7, "query must bound the returned rows");
                joined.extend(page);
            }
            assert_eq!(joined, full, "sort={sort_mode}, season={season:?}");
        }
    }
    connection.execute("UPDATE collection_items SET season_number = NULL, episode_number = NULL, absolute_order = 0, display_title = 'same' WHERE collection_id = ?1", [&collection.id]).unwrap();
    let full = repository.list_collection_episodes(&collection.id, None).unwrap();
    let mut ids = full.iter().map(|item| item.project_id.clone()).collect::<Vec<_>>();
    let actual = ids.clone();
    ids.sort();
    assert_eq!(actual, ids, "project identity breaks ties deterministically");
    let first = repository.list_collection_episode_window(&collection.id, None, 14, 0).unwrap();
    let second = repository.list_collection_episode_window(&collection.id, None, 14, 14).unwrap();
    assert_eq!([first, second].concat(), full);
    assert!(repository.list_collection_episode_window(&collection.id, None, 7, 100).unwrap().is_empty());
}
