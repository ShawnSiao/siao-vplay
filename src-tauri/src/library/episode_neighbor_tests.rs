#[test]
fn neighbor_lookup_does_not_decode_unrelated_later_rows() {
    let fixture = Fixture::new();
    let collection = fixture.collection("bounded neighbors");
    let mut projects = Vec::new();
    for index in 0..4 {
        let project = fixture.project(&format!("neighbor-{index}.mp4"));
        fixture.add(&collection, &project, 1, index + 1, index);
        projects.push(project);
    }
    // An isolated malformed non-neighbor proves that lookup stops after the next row.
    fixture.service.store.connect().unwrap().execute(
        "UPDATE collection_items SET display_title = X'80' WHERE collection_id = ?1 AND project_id = ?2",
        rusqlite::params![collection.id, projects[3].id],
    ).unwrap();
    let neighbors = fixture.service.get_episode_neighbors(&collection.id, &projects[0].id).unwrap();
    assert!(neighbors.previous.is_none());
    assert_eq!(neighbors.next.unwrap().project_id, projects[1].id);
    assert!(fixture.service.get_episode_neighbors(&collection.id, &projects[2].id).is_err(),
        "a malformed actual neighbor must still fail");
}

#[test]
fn neighbor_order_matches_manual_episode_null_and_case_ties() {
    let fixture = Fixture::new();
    let collection = fixture.collection("neighbor order");
    let fields = [(Some(2), Some(1), 4, "b"), (Some(1), Some(2), 2, "a"),
        (None, None, 3, "unknown"), (Some(1), None, 1, "A"), (Some(1), None, 1, "a")];
    let mut expected = Vec::new();
    for (index, (season, episode, order, title)) in fields.into_iter().enumerate() {
        let project = fixture.project(&format!("sort-{index}.mp4"));
        fixture.add(&collection, &project, 1, 1, order);
        fixture.service.store.connect().unwrap().execute(
            "UPDATE collection_items SET season_number=?1, episode_number=?2, display_title=?3 WHERE collection_id=?4 AND project_id=?5",
            rusqlite::params![season, episode, title, collection.id, project.id],
        ).unwrap();
        expected.push(super::super::EpisodeReference { project_id: project.id, display_title: title.into(),
            season_number: season, episode_number: episode, absolute_order: order });
    }
    for mode in ["manual", "episode"] {
        fixture.service.store.connect().unwrap().execute("UPDATE collections SET sort_mode=?1 WHERE id=?2", rusqlite::params![mode, collection.id]).unwrap();
        expected.sort_by_key(|item| (if mode == "manual" { None } else { item.season_number },
            if mode == "manual" { None } else { item.episode_number }, item.absolute_order, item.display_title.to_ascii_lowercase(), item.project_id.clone()));
        for (index, item) in expected.iter().enumerate() {
            let result = fixture.service.get_episode_neighbors(&collection.id, &item.project_id).unwrap();
            assert_eq!(result.previous.as_ref(), index.checked_sub(1).map(|index| &expected[index]));
            assert_eq!(result.next.as_ref(), expected.get(index + 1));
        }
    }
    let missing = Uuid::new_v4().to_string();
    assert!(matches!(fixture.service.get_episode_neighbors(&collection.id, &missing), Err(LibraryError::MembershipNotFound { .. })));
    assert!(matches!(fixture.service.get_episode_neighbors(&missing, &missing), Err(LibraryError::MembershipNotFound { .. })));
}
