use super::*;

#[test]
fn revision_does_not_read_unselected_history() {
    let (_temp, store, project_id, original) = create_store_with_subtitles();
    let revise = |base: &SubtitleVersion| {
        revise_subtitle_version(
            &store,
            ReviseSubtitleVersionInput {
                project_id: project_id.clone(),
                base_version_id: base.id.clone(),
                expected_project_revision: base.project_revision,
                segment_edits: vec![],
                global_replacement: None,
                offset_ms: 100,
            },
        )
    };
    let current = revise(&original).expect("first revision");
    // A deliberately invalid historical payload detects any accidental history decoding.
    store
        .connect()
        .unwrap()
        .execute(
            "UPDATE subtitle_versions SET preflight_json = 'invalid' WHERE id = ?1",
            params![original.id],
        )
        .unwrap();
    let next = revise(&current).expect("unselected history must not be read");
    assert_eq!(next.segments[0].start_ms, 200);
    let restored = restore_subtitle_version(
        &store,
        RestoreSubtitleVersionInput {
            project_id,
            current_version_id: next.id,
            restore_version_id: current.id,
            expected_project_revision: next.project_revision,
        },
    )
    .expect("restore reads only selected versions");
    assert_eq!(restored.segments[0].start_ms, 100);
    let current_versions = list_current_subtitle_versions(&store, &restored.project_id).unwrap();
    assert_eq!(current_versions.len(), 1);
    assert_eq!(current_versions[0].id, restored.id);
    let metadata = metadata::list_metadata(&store, &restored.project_id).unwrap();
    assert_eq!(metadata.len(), 4);
    assert!(metadata.iter().all(|item| item.segment_count == 2));
    let serialized = serde_json::to_value(&metadata).unwrap();
    assert!(
        serialized
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item.get("segments").is_none() && item.get("preflight").is_none())
    );
    assert!(matches!(
        get_subtitle_version(&store, &restored.project_id, "missing"),
        Err(SubtitleError::VersionNotFound(_))
    ));
    assert!(get_subtitle_version(&store, &restored.project_id, &original.id).is_err());
    let other_path = _temp.path().join("other.mp4");
    fs::write(&other_path, b"other media").unwrap();
    let other = store
        .create_local_project(CreateLocalProjectInput {
            media_path: other_path.to_string_lossy().into_owned(),
            title: None,
        })
        .unwrap();
    assert!(matches!(
        get_subtitle_version(&store, &other.id, &restored.id),
        Err(SubtitleError::VersionNotFound(_))
    ));
    store
        .connect()
        .unwrap()
        .execute(
            "UPDATE subtitle_tracks SET current_version_id = NULL WHERE project_id = ?1",
            params![restored.project_id],
        )
        .unwrap();
    assert!(
        metadata::list_metadata(&store, &restored.project_id)
            .unwrap()
            .iter()
            .all(|item| !item.is_current)
    );
}
