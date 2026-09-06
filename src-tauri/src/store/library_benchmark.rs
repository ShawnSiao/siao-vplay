use super::*;
use crate::library::{LibraryMediaSection, LibraryService, ListLibrarySectionInput};
use serde::Serialize;
use std::time::Instant;

fn measure<T: Serialize>(label: &str, read: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let value = read();
    let bytes = serde_json::to_vec(&value).unwrap().len();
    println!(
        "{label}: bytes={bytes} elapsed_ms={:.3}",
        start.elapsed().as_secs_f64() * 1000.0
    );
    value
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
                    offset: 0,
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
}
