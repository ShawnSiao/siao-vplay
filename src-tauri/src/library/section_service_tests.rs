use crate::library::{LibraryMediaSection, ListLibrarySectionInput};

#[test]
fn collection_summary_and_seasons_share_a_snapshot() {
    let fixture = Fixture::new();
    let collection = fixture.collection("snapshot");
    let project = fixture.project("collection-snapshot.mp4");
    fixture.add(&collection, &project, 1, 1, 0);
    let detail = fixture.service.get_collection_detail_with_checkpoint(&collection.id, || {
        fixture.service.remove_project_from_collection(&collection.id, &project.id).unwrap();
    }).unwrap();
    assert_eq!(detail.summary.item_count, 1);
    assert_eq!(detail.seasons.len(), 1, "seasons must match the summary read snapshot");
    assert_eq!(detail.seasons[0].episode_count, 1);
    let current = fixture.service.get_collection_detail(&collection.id).unwrap();
    assert_eq!(current.summary.item_count, 0);
    assert!(current.seasons.is_empty());
    assert!(fixture.service.store.get_project(&project.id).is_ok());
}

#[test]
fn home_counts_and_previews_share_a_snapshot_during_deletion() {
    let fixture = Fixture::new();
    let project = fixture.project("home-snapshot.mp4");
    let home = fixture.service.get_home_with_checkpoint(|| {
        assert!(fixture.service.store.delete_project(&project.id).unwrap().deleted);
    }).unwrap();
    assert_eq!(home.total_project_count, 1);
    assert_eq!(home.unclassified_count, 1);
    assert_eq!(home.unclassified.len(), 1, "home count and previews must share a snapshot");
    assert_eq!(home.recently_added[0].project_id, project.id);
    let current = fixture.service.get_home().unwrap();
    assert_eq!(current.total_project_count, 0);
    assert!(current.unclassified.is_empty());
    assert!(current.recently_added.is_empty());
}

#[test]
fn section_items_and_count_share_a_snapshot_during_deletion() {
    let fixture = Fixture::new();
    let project = fixture.project("snapshot.mp4");
    let page = fixture.service.list_section_with_checkpoint(
        ListLibrarySectionInput { section: LibraryMediaSection::Unclassified, offset: 0, expected_snapshot_token: None },
        || { assert!(fixture.service.store.delete_project(&project.id).unwrap().deleted); },
    ).unwrap();
    assert_eq!(page.total_count, 1);
    assert_eq!(page.items.len(), 1, "count and rows must describe the same snapshot");
    assert_eq!(page.items[0].project_id, project.id);
    assert_eq!(page.next_offset, None);
    let current = fixture.service.list_section(ListLibrarySectionInput { section: LibraryMediaSection::Unclassified, offset: 0, expected_snapshot_token: None }).unwrap();
    assert_eq!(current.total_count, 0);
    assert!(current.items.is_empty());
}

#[test]
fn library_sections_page_without_truncating_totals() {
    let fixture = Fixture::new();
    let projects = (0..26)
        .map(|index| fixture.project(&format!("video-{index:02}.mp4")))
        .collect::<Vec<_>>();

    let first = fixture
        .service
        .list_section(ListLibrarySectionInput {
            section: LibraryMediaSection::Unclassified,
            offset: 0, expected_snapshot_token: None,
        })
        .expect("first page should load");
    assert_eq!(first.total_count, 26);
    assert_eq!(first.items.len(), 24);
    assert_eq!(first.next_offset, Some(24));

    let second = fixture
        .service
        .list_section(ListLibrarySectionInput {
            section: LibraryMediaSection::Unclassified,
            offset: 24, expected_snapshot_token: Some(first.snapshot_token.clone()),
        })
        .expect("second page should load");
    assert_eq!(second.total_count, 26);
    assert_eq!(second.items.len(), 2);
    assert_eq!(second.next_offset, None);
    assert!(first.items.iter().all(|item| {
        second
            .items
            .iter()
            .all(|other| other.project_id != item.project_id)
    }));

    fixture
        .service
        .set_watch_later(&projects[0].id, true)
        .expect("watch later should add");
    let watch_later = fixture
        .service
        .list_section(ListLibrarySectionInput {
            section: LibraryMediaSection::WatchLater,
            offset: 0, expected_snapshot_token: None,
        })
        .expect("watch later should load");
    assert_eq!(watch_later.total_count, 1);
    assert_eq!(watch_later.items[0].project_id, projects[0].id);
}

#[test]
fn continue_watching_count_is_not_limited_to_the_home_preview() {
    let fixture = Fixture::new();
    for index in 0..13 {
        let project = fixture.project(&format!("continue-{index:02}.mp4"));
        let connection = fixture
            .service
            .store
            .connect()
            .expect("store should connect");
        connection
            .execute(
                "UPDATE playback_states
                 SET position_ms = 1000, duration_ms = 10000, completed_at_ms = NULL
                 WHERE project_id = ?1",
                params![project.id],
            )
            .expect("playback should update");
    }

    let home = fixture.service.get_home().expect("home should load");
    assert_eq!(home.continue_watching.len(), 12);
    assert_eq!(home.continue_watching_count, 13);
    let page = fixture
        .service
        .list_section(ListLibrarySectionInput {
            section: LibraryMediaSection::ContinueWatching,
            offset: 12, expected_snapshot_token: Some(fixture.service.list_section(ListLibrarySectionInput { section: LibraryMediaSection::ContinueWatching, offset: 0, expected_snapshot_token: None }).unwrap().snapshot_token),
        })
        .expect("continuation page should load");
    assert_eq!(page.total_count, 13);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.next_offset, None);
}

#[test]
fn library_section_rejects_negative_offset() {
    let fixture = Fixture::new();
    let error = fixture
        .service
        .list_section(ListLibrarySectionInput {
            section: LibraryMediaSection::Unclassified,
            offset: -1, expected_snapshot_token: None,
        })
        .expect_err("negative offset should fail");
    assert!(matches!(error, LibraryError::Validation(_)));
}

#[test]
fn home_media_windows_preserve_eligibility_order_and_one_membership() {
    let fixture = Fixture::new();
    let first = fixture.collection("First");
    let second = fixture.collection("Second");
    let chosen = if first.id < second.id { &first } else { &second };
    let mut ids = Vec::new();
    for index in 0..40_i64 {
        let project = fixture.project(&format!("window-{index}.mp4"));
        fixture.add(&first, &project, 1, index + 1, index);
        fixture.add(&second, &project, 1, index + 1, index);
        let connection = fixture.service.store.connect().unwrap();
        connection.execute("UPDATE projects SET created_at_ms=?1, updated_at_ms=?1, last_opened_at_ms=?1 WHERE id=?2", params![index+100,project.id]).unwrap();
        connection.execute("UPDATE playback_states SET position_ms=?1, completed_at_ms=?2 WHERE project_id=?3",
            params![if index%7 == 0 {0} else {1000}, (index>=35).then_some(200), project.id]).unwrap();
        ids.push(project.id);
    }
    let connection = fixture.service.store.connect().unwrap();
    let repository = LibraryRepository::new(&connection);
    let expected: Vec<_> = (0..40).rev().filter(|index| *index<35 && index%7!=0).skip(3).take(7).map(|index| ids[index].clone()).collect();
    let page = repository.list_continue_watching_page(7,3).unwrap();
    assert_eq!(page.iter().map(|item| item.project_id.clone()).collect::<Vec<_>>(),expected);
    assert!(page.iter().all(|item| item.collection_id.as_deref()==Some(chosen.id.as_str()) && item.collection_title.as_deref()==Some(chosen.title.as_str())));
    assert!(page.iter().all(|item| item.position_ms==1000 && item.completed_at_ms.is_none()));
    let recent = repository.list_recently_added(5).unwrap();
    assert_eq!(recent.iter().map(|item| item.project_id.clone()).collect::<Vec<_>>(),ids.iter().rev().take(5).cloned().collect::<Vec<_>>());
    assert!(recent.iter().all(|item| item.collection_id.as_deref()==Some(chosen.id.as_str())));
    assert!(repository.list_continue_watching_page(7,100).unwrap().is_empty());
}
