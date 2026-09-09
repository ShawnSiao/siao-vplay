use super::*;
use crate::library::{LibraryMediaSection, LibraryService, ListLibrarySectionInput};
use serde::Serialize;
use std::time::Instant;

fn measure<T: Serialize>(label: &str, mut read: impl FnMut() -> T) -> T {
    const SAMPLES: usize = 20;
    let mut elapsed = Vec::with_capacity(SAMPLES);
    let mut last = None;
    let mut expected_bytes = None;
    for _ in 0..SAMPLES {
        let start = Instant::now();
        let value = read();
        let bytes = serde_json::to_vec(&value).unwrap().len();
        elapsed.push(start.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(*expected_bytes.get_or_insert(bytes), bytes, "unstable fixture: {label}");
        last = Some(value);
    }
    elapsed.sort_by(f64::total_cmp);
    println!("{}", serde_json::json!({
        "scenario": label, "samples": SAMPLES, "bytes": expected_bytes.unwrap(),
        "readAndSerializeMs": { "min": elapsed[0],
            "median": (elapsed[SAMPLES / 2 - 1] + elapsed[SAMPLES / 2]) / 2.0,
            "p95": elapsed[(SAMPLES * 95).div_ceil(100) - 1], "max": elapsed[SAMPLES - 1] }
    }));
    last.unwrap()
}

#[test]
#[ignore = "explicit synthetic 1k/10k library benchmark; requires temporary disk space"]
fn benchmark_library_summary_reads() {
    let temp = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(temp.path().join("library.db")).unwrap();
    let service = LibraryService::new(store.clone());
    let mut seeded = 0;
    for count in [1_000, 10_000] {
        let mut connection = store.connect().unwrap();
        let transaction = connection.transaction().unwrap();
        for index in seeded..count {
            let id = Uuid::new_v4().to_string();
            let media_id = Uuid::new_v4().to_string();
            let title = format!("Synthetic video {index:05}");
            let path = temp.path().join(format!("video-{index:05}.mp4"));
            fs::write(&path, b"synthetic benchmark fixture; not playable media").unwrap();
            let timestamp = 1_700_000_000_000_i64 + index;
            transaction.execute(
                "INSERT INTO projects (id,title,revision,created_at_ms,updated_at_ms,last_opened_at_ms)
                 VALUES (?1,?2,1,?3,?3,?3)", params![id, title, timestamp],
            ).unwrap();
            transaction.execute(
                "INSERT INTO media_sources (id,project_id,kind,locator,display_name,is_primary,created_at_ms,updated_at_ms)
                 VALUES (?1,?2,'local_file',?3,?4,1,?5,?5)",
                params![media_id, id, path_to_string(&path), title, timestamp],
            ).unwrap();
            transaction.execute(
                "INSERT INTO playback_states (project_id,position_ms,duration_ms,volume,playback_rate,subtitle_mode,updated_at_ms)
                 VALUES (?1,?2,120000,1.0,1.0,'translation',?3)",
                params![id, if index % 2 == 0 { 4200 } else { 0 }, timestamp],
            ).unwrap();
        }
        transaction.commit().unwrap();
        seeded = count;
        // Exclude fixture creation and warm-up from the measured read plus serialization.
        service.get_home().unwrap();
        service.search("Synthetic").unwrap();
        let home = measure(&format!("{count} home"), || service.get_home().unwrap());
        assert_eq!(home.total_project_count, count);
        assert_eq!(home.continue_watching.len(), 12);
        assert_eq!(home.unclassified.len(), 24);
        assert_eq!(home.recently_added.len(), 5);
        let search = measure(&format!("{count} search"), || {
            service.search("Synthetic").unwrap()
        });
        assert_eq!(search.len(), 50);
        let page = measure(&format!("{count} page"), || {
            service
                .list_section(ListLibrarySectionInput {
                    section: LibraryMediaSection::Unclassified,
                    offset: 0, expected_snapshot_token: None,
                })
                .unwrap()
        });
        assert_eq!(page.items.len(), 24);
        assert_eq!(page.total_count, count);
        assert_eq!(page.next_offset, Some(24));
        let legacy = measure(&format!("{count} full projects"), || {
            store.list_projects().unwrap()
        });
        assert_eq!(legacy.len(), count as usize);
    }
    let collection = service.create_collection(crate::library::CreateCollectionInput { title: "Synthetic large collection".into() }).unwrap();
    store.connect().unwrap().execute(
        "INSERT INTO collection_items (collection_id, project_id, season_number, episode_number,
            absolute_order, display_title, availability, created_at_ms, updated_at_ms)
         SELECT ?1, id, 1, ROW_NUMBER() OVER (ORDER BY title), ROW_NUMBER() OVER (ORDER BY title) - 1,
            title, 'available', created_at_ms, updated_at_ms FROM projects",
        [&collection.id],
    ).unwrap();
    let input = crate::library::ListCollectionEpisodePageInput { collection_id: collection.id, season_number: None,
        offset: 0, expected_snapshot_token: None };
    service.list_collection_episode_page(input.clone()).unwrap();
    let first = measure("10000 collection first page with snapshot", || service.list_collection_episode_page(input.clone()).unwrap());
    assert_eq!(first.items.len(), 24);
    assert_eq!(first.total_count, 10_000);
    let last_input = crate::library::ListCollectionEpisodePageInput { offset: 9_984,
        expected_snapshot_token: Some(first.snapshot_token.clone()), ..input };
    let last = measure("10000 collection last page with snapshot", || service.list_collection_episode_page(last_input.clone()).unwrap());
    assert_eq!(last.items.len(), 16);
    assert_eq!(last.next_offset, None);
    assert_eq!(last.snapshot_token, first.snapshot_token);
    let middle_id: String = store.connect().unwrap().query_row(
        "SELECT project_id FROM collection_items WHERE collection_id=?1 AND absolute_order=5000",
        [&last.collection_id], |row| row.get(0)).unwrap();
    for (label, project_id) in [("first", &first.items[0].project_id), ("middle", &middle_id), ("last", &last.items.last().unwrap().project_id)] {
        let neighbors = measure(&format!("10000 collection neighbors {label}"), || service.get_episode_neighbors(&last.collection_id, project_id).unwrap());
        assert_eq!(neighbors.previous.is_some(), label != "first");
        assert_eq!(neighbors.next.is_some(), label != "last");
    }

}
