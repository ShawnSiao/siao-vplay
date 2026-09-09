use super::*;
use super::super::metadata_page::{MetadataPageInput, page_with_checkpoint};

fn first(project_id: &str) -> MetadataPageInput {
    MetadataPageInput { project_id: project_id.into(), offset: 0, expected_snapshot_token: None }
}

#[test]
fn metadata_pages_are_bounded_and_reject_same_count_reordering() {
    let (_temp, store, project_id, original) = create_store_with_subtitles();
    let connection = store.connect().unwrap();
    connection.execute("UPDATE subtitle_versions SET created_at_ms = 0 WHERE id = ?1", params![original.id]).unwrap();
    for index in 0..30 {
        connection.execute(
            "INSERT INTO subtitle_versions (id, track_id, project_id, version_number, status, source_kind,
             source_label, source_sha256, media_sha256, language_code, project_revision, preflight_json, created_at_ms)
             SELECT ?1, track_id, project_id, ?2, status, source_kind, source_label, source_sha256,
             media_sha256, language_code, project_revision, preflight_json, 100 FROM subtitle_versions WHERE id = ?3",
            params![format!("page-{index:02}"), index + 2, original.id],
        ).unwrap();
    }
    let page = page_with_checkpoint(&store, first(&project_id), || {}).unwrap();
    assert_eq!(page.items.len(), 24);
    assert_eq!(page.total_count, 31);
    assert_eq!(page.next_offset, Some(24));
    assert_eq!(page.items[0].id, "page-29");
    assert_eq!(page.items[23].id, "page-06");
    let next = MetadataPageInput { offset: 24, expected_snapshot_token: Some(page.snapshot_token), ..first(&project_id) };
    let end = page_with_checkpoint(&store, next.clone(), || {}).unwrap();
    assert_eq!(end.items.len(), 7);
    assert_eq!(end.items[0].id, "page-05");
    assert_eq!(end.items[6].id, original.id);
    assert_eq!(end.next_offset, None);
    connection.execute("UPDATE subtitle_versions SET created_at_ms = 200 WHERE id = ?1", params![original.id]).unwrap();
    assert!(matches!(page_with_checkpoint(&store, next, || {}), Err(SubtitleError::VersionChanged)));
    assert_eq!(page_with_checkpoint(&store, first(&project_id), || {}).unwrap().items[0].id, original.id);
}

#[test]
fn metadata_page_count_and_rows_share_a_snapshot() {
    let (_temp, store, project_id, original) = create_store_with_subtitles();
    let page = page_with_checkpoint(&store, first(&project_id), || {
        store.connect().unwrap().execute("DELETE FROM subtitle_versions WHERE id = ?1", params![original.id]).unwrap();
    }).unwrap();
    assert_eq!(page.total_count, 1);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, original.id);
    assert_eq!(page.next_offset, None);
    assert_eq!(page_with_checkpoint(&store, first(&project_id), || {}).unwrap().total_count, 0);
}

#[test]
fn metadata_page_rejects_changed_current_pointer_and_invalid_requests() {
    let (_temp, store, project_id, _original) = create_store_with_subtitles();
    let page = page_with_checkpoint(&store, first(&project_id), || {}).unwrap();
    let next = MetadataPageInput { offset: 24, expected_snapshot_token: Some(page.snapshot_token), ..first(&project_id) };
    assert!(page_with_checkpoint(&store, next.clone(), || {}).is_ok());
    store.connect().unwrap().execute("UPDATE subtitle_tracks SET current_version_id = NULL WHERE project_id = ?1", params![project_id]).unwrap();
    assert!(matches!(page_with_checkpoint(&store, next, || {}), Err(SubtitleError::VersionChanged)));
    for offset in [-1, 9007199254740992, 24] {
        assert!(page_with_checkpoint(&store, MetadataPageInput { offset, ..first(&project_id) }, || {}).is_err());
    }
    assert!(page_with_checkpoint(&store, first("missing"), || {}).is_err());
}
