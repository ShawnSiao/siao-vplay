use super::*;
use super::super::metadata_page::{MetadataPageInput, page_with_checkpoint};
use serde::Serialize;
use std::time::Instant;

pub(super) fn measure<T: Serialize>(label: &str, mut read: impl FnMut() -> T) -> (T, usize) {
    const SAMPLES: usize = 20;
    let mut times = Vec::with_capacity(SAMPLES);
    let mut last = None;
    let mut expected_bytes = None;
    for _ in 0..SAMPLES {
        let started = Instant::now();
        let value = read();
        let bytes = serde_json::to_vec(&value).unwrap().len();
        times.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(*expected_bytes.get_or_insert(bytes), bytes, "unstable fixture: {label}");
        last = Some(value);
    }
    times.sort_by(f64::total_cmp);
    println!("{}", serde_json::json!({ "scenario": label, "samples": SAMPLES, "bytes": expected_bytes,
        "readAndSerializeMs": { "min": times[0], "median": (times[9] + times[10]) / 2.0,
            "p95": times[18], "max": times[19] } }));
    (last.unwrap(), expected_bytes.unwrap())
}

#[test]
#[ignore = "explicit synthetic 1k/10k subtitle metadata paging benchmark; requires temporary disk space"]
fn benchmark_subtitle_metadata_pages() {
    let (_temp, store, project_id, original) = create_store_with_subtitles();
    let body = "Synthetic subtitle history content. ".repeat(160);
    let mut inserted = 0;
    let mut current_bytes = None;
    for count in [1_000, 10_000] {
        let mut connection = store.connect().unwrap();
        let transaction = connection.transaction().unwrap();
        for index in inserted..count {
            let id = format!("metadata-benchmark-{index}");
            transaction.execute(
                "INSERT INTO subtitle_versions (id, track_id, project_id, version_number, status, source_kind,
                 source_label, source_sha256, media_sha256, language_code, project_revision, preflight_json, created_at_ms)
                 SELECT ?1, track_id, project_id, ?2, status, source_kind, source_label, source_sha256,
                 media_sha256, language_code, project_revision, preflight_json, created_at_ms FROM subtitle_versions WHERE id = ?3",
                params![id, index + 2, original.id],
            ).unwrap();
            transaction.execute(
                "INSERT INTO subtitle_segments (id, version_id, ordinal, start_ms, end_ms, text)
                 SELECT ?1 || '-' || ordinal, ?1, ordinal, start_ms, end_ms, ?2 FROM subtitle_segments WHERE version_id = ?3",
                params![id, body, original.id],
            ).unwrap();
        }
        transaction.commit().unwrap();
        inserted = count;
        let input = MetadataPageInput { project_id: project_id.clone(), offset: 0, expected_snapshot_token: None };
        page_with_checkpoint(&store, input.clone(), || {}).unwrap();
        let (first, first_bytes) = measure(&format!("{count} metadata first page"), || page_with_checkpoint(&store, input.clone(), || {}).unwrap());
        let offset = count / 24 * 24;
        let next = MetadataPageInput { offset, expected_snapshot_token: Some(first.snapshot_token.clone()), ..input };
        let (last, last_bytes) = measure(&format!("{count} metadata last page"), || page_with_checkpoint(&store, next.clone(), || {}).unwrap());
        let (current, bytes) = measure(&format!("{count} current metadata"), || {
            let connection = store.connect().unwrap();
            metadata::read_metadata_selection(&connection, &project_id, None, true).unwrap()
        });
        let (full, full_bytes) = measure(&format!("{count} full metadata"), || metadata::list_metadata(&store, &project_id).unwrap());
        assert_eq!(first.items.len(), 24);
        assert_eq!(first.total_count, count + 1);
        assert_eq!(first.current_versions.len(), 1);
        assert_eq!(last.items.len() as i64, count + 1 - offset);
        assert!(last.next_offset.is_none());
        assert_eq!(current.len(), 1);
        assert_eq!(*current_bytes.get_or_insert(bytes), bytes);
        assert_eq!(full.len() as i64, count + 1);
        assert!(first_bytes < 12_000 && last_bytes < 12_000, "page payload grew with history");
        assert!(full_bytes > first_bytes * 30);
    }
}
