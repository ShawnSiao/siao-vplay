#[test]
fn collection_episode_page_count_and_rows_share_snapshot() {
    let fixture = Fixture::new();
    let collection = fixture.collection("snapshot");
    let project = fixture.project("page-snapshot.mp4");
    fixture.add(&collection, &project, 1, 1, 0);
    let input = crate::library::ListCollectionEpisodePageInput { collection_id: collection.id.clone(), season_number: None, offset: 0, expected_snapshot_token: None };
    let page = fixture.service.collection_episode_page_with_checkpoint(input.clone(), || {
        fixture.service.remove_project_from_collection(&collection.id, &project.id).unwrap();
    }).unwrap();
    assert_eq!(page.total_count, 1);
    assert_eq!(page.items.len(), 1, "page must retain count's snapshot");
    let next = fixture.service.list_collection_episode_page(input).unwrap();
    assert_eq!(next.total_count, 0);
    assert!(next.items.is_empty());
}

#[test]
fn episode_windows_preserve_order_without_gaps_or_duplicates() {
    let fixture = Fixture::new();
    let collection = fixture.collection("paged");
    let mut project_ids = Vec::new();
    for index in 0..27 {
        let project = fixture.project(&format!("page-{index:02}.mp4"));
        fixture.add(&collection, &project, index % 2 + 1, index / 2 + 1, 27 - index);
        project_ids.push(project.id);
    }
    let connection = fixture.service.store.connect().unwrap();
    let repository = LibraryRepository::new(&connection);
    for sort_mode in ["manual", "episode"] {
        connection.execute("UPDATE collections SET sort_mode = ?1 WHERE id = ?2", rusqlite::params![sort_mode, collection.id]).unwrap();
        for season in [None, Some(1), Some(2), Some(99)] {
            let full = repository.list_collection_episodes(&collection.id, season).unwrap();
            let mut expected: Vec<usize> = (0..27).filter(|index| season.is_none_or(|season| (*index as i64) % 2 + 1 == season)).collect();
            if sort_mode == "manual" { expected.reverse(); }
            else { expected.sort_by_key(|index| (index % 2, index / 2)); }
            assert_eq!(full.iter().map(|item| &item.project_id).collect::<Vec<_>>(),
                expected.iter().map(|index| &project_ids[*index]).collect::<Vec<_>>());
            let input = crate::library::ListCollectionEpisodePageInput {
                collection_id: collection.id.clone(), season_number: season, offset: 0, expected_snapshot_token: None,
            };
            let first = fixture.service.list_collection_episode_page(input.clone()).unwrap();
            assert_eq!(first.collection_id, collection.id);
            assert_eq!(first.season_number, season);
            assert_eq!(first.offset, 0);
            assert_eq!(first.total_count, full.len() as i64);
            assert_eq!(first.items, full[..full.len().min(24)]);
            assert_eq!(first.next_offset, (full.len() > 24).then_some(24));
            let end = fixture.service.list_collection_episode_page(crate::library::ListCollectionEpisodePageInput { offset: 24, expected_snapshot_token: Some(first.snapshot_token), ..input.clone() }).unwrap();
            assert_eq!(end.items, full[full.len().min(24)..]);
            assert_eq!(end.next_offset, None);
            assert!(fixture.service.list_collection_episode_page(crate::library::ListCollectionEpisodePageInput { offset: -1, ..input }).is_err());
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
