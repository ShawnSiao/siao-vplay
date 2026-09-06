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

#[test]
#[ignore = "synthetic 1000/10000 subtitle history benchmark; run explicitly with --ignored --nocapture"]
fn benchmark_subtitle_history_reads() {
    use std::time::Instant;
    let (_temp, store, project_id, original) = create_store_with_subtitles();
    let body = "Synthetic subtitle history content. ".repeat(160);
    let baseline_bytes =
        serde_json::to_vec(&list_current_subtitle_versions(&store, &project_id).unwrap())
            .unwrap()
            .len();
    let mut inserted = 0;
    for count in [1_000, 10_000] {
        let mut connection = store.connect().unwrap();
        let transaction = connection.transaction().unwrap();
        for index in inserted..count {
            let id = format!("history-benchmark-{index}");
            transaction.execute(
                "INSERT INTO subtitle_versions (id, track_id, project_id, version_number, status, source_kind,
                 source_label, source_sha256, media_sha256, language_code, project_revision, preflight_json, created_at_ms)
                 SELECT ?1, track_id, project_id, ?2, status, source_kind, source_label, source_sha256,
                 media_sha256, language_code, project_revision, preflight_json, created_at_ms FROM subtitle_versions WHERE id = ?3",
                params![id, i64::try_from(index + 2).unwrap(), original.id],
            ).unwrap();
            transaction.execute(
                "INSERT INTO subtitle_segments (id, version_id, ordinal, start_ms, end_ms, text)
                 SELECT ?1 || '-' || ordinal, ?1, ordinal, start_ms, end_ms, ?2 FROM subtitle_segments WHERE version_id = ?3",
                params![id, body, original.id],
            ).unwrap();
        }
        transaction.commit().unwrap();
        inserted = count;
        let started = Instant::now();
        let current = list_current_subtitle_versions(&store, &project_id).unwrap();
        let current_bytes = serde_json::to_vec(&current).unwrap().len();
        let current_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let started = Instant::now();
        let metadata = metadata::list_metadata(&store, &project_id).unwrap();
        let metadata_bytes = serde_json::to_vec(&metadata).unwrap().len();
        let metadata_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let started = Instant::now();
        let all = list_subtitle_versions(&store, &project_id).unwrap();
        let all_bytes = serde_json::to_vec(&all).unwrap().len();
        let all_ms = started.elapsed().as_secs_f64() * 1_000.0;
        assert_eq!(current.len(), 1);
        assert_eq!(current_bytes, baseline_bytes);
        assert_eq!(metadata.len(), count + 1);
        assert_eq!(all.len(), count + 1);
        assert!(metadata_bytes * 10 < all_bytes);
        println!(
            "{}",
            serde_json::json!({"scenario": "synthetic_warm_subtitle_history", "historyVersions": count,
            "current": {"readAndSerializeMs": current_ms, "bytes": current_bytes},
            "metadata": {"readAndSerializeMs": metadata_ms, "bytes": metadata_bytes},
            "all": {"readAndSerializeMs": all_ms, "bytes": all_bytes}})
        );
    }
}
