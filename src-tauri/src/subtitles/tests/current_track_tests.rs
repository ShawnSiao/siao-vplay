use super::*;

fn seed_other_projects(store: &ProjectStore, start: i64, end: i64) {
    let mut connection = store.connect().unwrap();
    let transaction = connection.transaction().unwrap();
    for index in start..end {
        let project = format!("other-{index}");
        transaction.execute("INSERT INTO projects (id,title,revision,created_at_ms,updated_at_ms,last_opened_at_ms) VALUES (?1,'Synthetic',1,1,1,1)", [&project]).unwrap();
        for (role, language) in [("original", "en"), ("translation", "ja"), ("translation", "ko")] {
            transaction.execute("INSERT INTO subtitle_tracks (id,project_id,role,language_code,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,1,1)",
                params![format!("{project}-{language}"), project, role, language]).unwrap();
        }
    }
    transaction.commit().unwrap();
}

fn add_translation(store: &ProjectStore, project: &str, base: &str, language: &str, id: &str) {
    let connection = store.connect().unwrap();
    let track = format!("track-{id}");
    connection.execute("INSERT INTO subtitle_tracks (id,project_id,role,language_code,created_at_ms,updated_at_ms) VALUES (?1,?2,'translation',?3,1,1)", params![track, project, language]).unwrap();
    connection.execute(
        "INSERT INTO subtitle_versions (id,track_id,project_id,version_number,status,source_kind,source_label,source_sha256,media_sha256,language_code,project_revision,preflight_json,created_at_ms)
         SELECT ?1,?2,?3,1,status,source_kind,source_label,source_sha256,media_sha256,?4,project_revision,preflight_json,created_at_ms FROM subtitle_versions WHERE id=?5",
        params![id, track, project, language, base]).unwrap();
    connection.execute("UPDATE subtitle_tracks SET current_version_id=?1 WHERE id=?2", params![id, track]).unwrap();
}

#[test]
fn current_reads_keep_all_target_languages_and_exclude_other_projects() {
    let (_temp, store, project, original) = create_store_with_subtitles();
    seed_other_projects(&store, 0, 2);
    add_translation(&store, &project, &original.id, "ja", "target-ja");
    add_translation(&store, &project, &original.id, "ko", "target-ko");
    add_translation(&store, "other-0", &original.id, "th", "unrelated-th");
    let connection = store.connect().unwrap();
    connection.execute("UPDATE subtitle_versions SET source_label=X'FF' WHERE id='unrelated-th'", []).unwrap();
    let current = list_current_subtitle_versions(&store, &project).unwrap();
    let metadata = metadata::read_metadata_selection(&connection, &project, None, true).unwrap();
    let mut expected = vec![original.id, "target-ja".into(), "target-ko".into()];
    expected.sort();
    let mut actual = current.iter().map(|item| item.id.clone()).collect::<Vec<_>>(); actual.sort();
    let mut metadata_ids = metadata.iter().map(|item| item.id.clone()).collect::<Vec<_>>(); metadata_ids.sort();
    assert_eq!(actual, expected);
    assert_eq!(metadata_ids, expected);
    assert!(current.iter().all(|item| item.project_id == project && item.is_current));
    assert!(metadata.iter().all(|item| item.project_id == project && item.is_current));
}

#[test]
#[ignore = "explicit current-track benchmark across1000/10000 unrelated projects"]
fn benchmark_current_tracks_across_projects() {
    let (_temp, store, project, _original) = create_store_with_subtitles();
    let mut inserted = 0;
    let mut expected_bytes = None;
    for count in [1_000, 10_000] {
        seed_other_projects(&store, inserted, count);
        inserted = count;
        list_current_subtitle_versions(&store, &project).unwrap();
        let (current, body_bytes) = super::metadata_benchmark::measure(&format!("{count} other projects current body"), || list_current_subtitle_versions(&store, &project).unwrap());
        let (metadata, metadata_bytes) = super::metadata_benchmark::measure(&format!("{count} other projects current metadata"), || {
            let connection = store.connect().unwrap();
            metadata::read_metadata_selection(&connection, &project, None, true).unwrap()
        });
        assert_eq!(current.len(), 1); assert_eq!(metadata.len(), 1);
        assert_eq!(*expected_bytes.get_or_insert((body_bytes, metadata_bytes)), (body_bytes, metadata_bytes));
    }
}
