use crate::library::{LibraryMediaSection, ListLibrarySectionInput};

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
        ListLibrarySectionInput { section: LibraryMediaSection::Unclassified, offset: 0 },
        || { assert!(fixture.service.store.delete_project(&project.id).unwrap().deleted); },
    ).unwrap();
    assert_eq!(page.total_count, 1);
    assert_eq!(page.items.len(), 1, "count and rows must describe the same snapshot");
    assert_eq!(page.items[0].project_id, project.id);
    assert_eq!(page.next_offset, None);
    let current = fixture.service.list_section(ListLibrarySectionInput { section: LibraryMediaSection::Unclassified, offset: 0 }).unwrap();
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
            offset: 0,
        })
        .expect("first page should load");
    assert_eq!(first.total_count, 26);
    assert_eq!(first.items.len(), 24);
    assert_eq!(first.next_offset, Some(24));

    let second = fixture
        .service
        .list_section(ListLibrarySectionInput {
            section: LibraryMediaSection::Unclassified,
            offset: 24,
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
            offset: 0,
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
            offset: 12,
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
            offset: -1,
        })
        .expect_err("negative offset should fail");
    assert!(matches!(error, LibraryError::Validation(_)));
}
