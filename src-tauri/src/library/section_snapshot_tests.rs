#[test]
fn section_continuation_rejects_changed_order_at_the_same_count() {
    let fixture = Fixture::new();
    for index in 0..26 { fixture.project(&format!("snapshot-{index}.mp4")); }
    let input = |offset, token: Option<String>| serde_json::from_value::<ListLibrarySectionInput>(serde_json::json!({
        "section": "unclassified", "offset": offset, "expectedSnapshotToken": token,
    })).unwrap();
    let first = fixture.service.list_section(input(0, None)).unwrap();
    let token = serde_json::to_value(&first).unwrap()["snapshotToken"].as_str().unwrap_or("missing").to_owned();
    let connection = fixture.service.store.connect().unwrap();
    connection.execute("UPDATE projects SET created_at_ms = created_at_ms + 100000 WHERE id = ?1", [&first.items[24 - 1].project_id]).unwrap();
    assert!(matches!(fixture.service.list_section(input(24, Some(token))), Err(LibraryError::Conflict(_))),
        "a same-count reorder must invalidate continuation instead of skipping or repeating rows");
}

#[test]
fn section_snapshots_bind_order_membership_and_section_but_not_display_fields() {
    for section in [LibraryMediaSection::Unclassified, LibraryMediaSection::WatchLater, LibraryMediaSection::ContinueWatching] {
        let fixture = Fixture::new();
        let connection = fixture.service.store.connect().unwrap();
        for index in 0..26 {
            let project = fixture.project(&format!("member-{index}.mp4"));
            if section == LibraryMediaSection::WatchLater { fixture.service.set_watch_later(&project.id, true).unwrap(); }
            if section == LibraryMediaSection::ContinueWatching {
                connection.execute("UPDATE playback_states SET position_ms = 1000 WHERE project_id = ?1", [&project.id]).unwrap();
            }
        }
        let input = ListLibrarySectionInput { section, offset: 0, expected_snapshot_token: None };
        let first = fixture.service.list_section(input.clone()).unwrap();
        let next = ListLibrarySectionInput { offset: 24, expected_snapshot_token: Some(first.snapshot_token.clone()), ..input.clone() };
        let second = fixture.service.list_section(next.clone()).unwrap();
        assert_eq!(first.items.len(), 24);
        assert_eq!(second.items.len(), 2);
        assert_eq!(first.total_count, 26);
        assert!(first.items.iter().all(|a| second.items.iter().all(|b| a.project_id != b.project_id)));
        assert!(fixture.service.list_section(ListLibrarySectionInput { offset: 24, ..input.clone() }).is_err());
        connection.execute("UPDATE projects SET title = 'display only'", []).unwrap();
        assert_eq!(fixture.service.list_section(next.clone()).unwrap().snapshot_token, first.snapshot_token);
        assert!(matches!(fixture.service.list_section(ListLibrarySectionInput {
            section: if section == LibraryMediaSection::Unclassified { LibraryMediaSection::WatchLater } else { LibraryMediaSection::Unclassified },
            ..next.clone()
        }), Err(LibraryError::Conflict(_))));
        let last_id = &second.items.last().unwrap().project_id;
        match section {
            LibraryMediaSection::Unclassified => { connection.execute("UPDATE projects SET created_at_ms = 9000000000000 WHERE id = ?1", [last_id]).unwrap(); }
            LibraryMediaSection::ContinueWatching => { connection.execute("UPDATE projects SET last_opened_at_ms = 9000000000000 WHERE id = ?1", [last_id]).unwrap(); }
            LibraryMediaSection::WatchLater => { connection.execute("UPDATE collection_items SET created_at_ms = 9000000000000 WHERE project_id = ?1", [last_id]).unwrap(); }
        }
        assert!(matches!(fixture.service.list_section(next), Err(LibraryError::Conflict(_))));
        let fresh = fixture.service.list_section(input.clone()).unwrap();
        assert_eq!(fresh.items[0].project_id, *last_id);
        fixture.service.store.delete_project(last_id).unwrap();
        assert!(matches!(fixture.service.list_section(ListLibrarySectionInput {
            expected_snapshot_token: Some(fresh.snapshot_token), ..input
        }), Err(LibraryError::Conflict(_))));
    }
}

#[test]
fn section_snapshot_and_rows_share_transaction_across_all_sections() {
    for section in [LibraryMediaSection::Unclassified, LibraryMediaSection::WatchLater, LibraryMediaSection::ContinueWatching] {
        let fixture = Fixture::new();
        let project = fixture.project("atomic.mp4");
        if section == LibraryMediaSection::WatchLater { fixture.service.set_watch_later(&project.id, true).unwrap(); }
        if section == LibraryMediaSection::ContinueWatching {
            fixture.service.store.connect().unwrap().execute("UPDATE playback_states SET position_ms = 1", []).unwrap();
        }
        let input = ListLibrarySectionInput { section, offset: 0, expected_snapshot_token: None };
        let baseline = fixture.service.list_section(input.clone()).unwrap();
        let page = fixture.service.list_section_with_checkpoint(input.clone(), || {
            fixture.service.store.delete_project(&project.id).unwrap();
        }).unwrap();
        assert_eq!(page.snapshot_token, baseline.snapshot_token);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.total_count, 1);
        let empty = fixture.service.list_section(input).unwrap();
        assert_ne!(empty.snapshot_token, baseline.snapshot_token);
        assert_eq!(empty.total_count, 0);
        assert!(empty.items.is_empty());
    }
}
