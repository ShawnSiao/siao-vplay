#[test]
#[ignore = "explicit synthetic overview benchmark; requires W-drive temporary storage"]
fn benchmark_library_overview_reads() {
    use crate::library::overview_model::{CollectionOverviewInput, OverviewPageInput};
    let temp = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(temp.path().join("overview.db")).unwrap();
    let service = LibraryService::new(store.clone());
    let mut seeded = 0;
    for count in [1_000_i64, 10_000] {
        let mut connection = store.connect().unwrap();
        let transaction = connection.transaction().unwrap();
        for index in seeded..count {
            let root = Uuid::new_v4().to_string();
            let project = Uuid::new_v4().to_string();
            let title = format!("Synthetic {index:05}");
            // Absent local paths model offline roots; never read real media.
            let root_path = temp.path().join(format!("root-{index:05}"));
            let path = path_to_string(&root_path);
            let timestamp = 1_700_000_000_000_i64 + index;
            transaction.execute("INSERT INTO library_roots (id,path,path_key,display_name,created_at_ms,updated_at_ms)
                VALUES (?1,?2,?2,?3,?4,?4)", params![root, path, title, timestamp]).unwrap();
            transaction.execute("INSERT INTO projects (id,title,revision,created_at_ms,updated_at_ms,last_opened_at_ms)
                VALUES (?1,?2,1,?3,?3,?3)", params![project,title,timestamp]).unwrap();
            transaction.execute("INSERT INTO media_sources (id,project_id,kind,locator,display_name,is_primary,created_at_ms,updated_at_ms)
                VALUES (?1,?2,'local_file',?3,?4,1,?5,?5)", params![Uuid::new_v4().to_string(),project,path_to_string(&root_path.join("video.mp4")),title,timestamp]).unwrap();
            transaction.execute("INSERT INTO playback_states (project_id,position_ms,duration_ms,volume,playback_rate,subtitle_mode,updated_at_ms)
                VALUES (?1,4200,120000,1.0,1.0,'translation',?2)", params![project,timestamp]).unwrap();
            transaction.execute("INSERT INTO library_root_items (root_id,project_id,absolute_order,display_title,created_at_ms,updated_at_ms)
                VALUES (?1,?2,0,?3,?4,?4)", params![root,project,title,timestamp]).unwrap();
            for linked in [false,true] {
                let collection = Uuid::new_v4().to_string();
                transaction.execute("INSERT INTO collections (id,kind,title,root_id,sort_mode,created_at_ms,updated_at_ms,last_opened_at_ms)
                    VALUES (?1,?2,?3,?4,'manual',?5,?5,?5)",
                    params![collection,if linked { "folder" } else { "manual" },title,linked.then_some(&root),timestamp]).unwrap();
                transaction.execute("INSERT INTO collection_items (collection_id,project_id,absolute_order,display_title,created_at_ms,updated_at_ms)
                    VALUES (?1,?2,0,?3,?4,?4)", params![collection,project,title,timestamp]).unwrap();
            }
        }
        transaction.commit().unwrap();
        seeded = count;
        if count == 10_000 {
            for (label, sql, values) in [
                ("continue", include_str!("../library/continue_watching_window.sql"), vec![12_i64,0]),
                ("recent", include_str!("../library/recently_added_window.sql"), vec![5_i64]),
            ] {
                let mut statement = connection.prepare(sql).unwrap();
                { let mut rows = statement.query(rusqlite::params_from_iter(values.iter())).unwrap(); while rows.next().unwrap().is_some() {} }
                println!("{}", serde_json::json!({"query":label,"vmSteps":statement.get_status(rusqlite::StatementStatus::VmStep)}));
                // Deterministic work budget for this pinned SQLite/10k fixture, not a wall-clock gate.
                // Baseline: continue534124 and recent451708 VM steps; require at least30% less work.
                let baseline_steps = if label == "continue" { 534_124 } else { 451_708 };
                assert!(statement.get_status(rusqlite::StatementStatus::VmStep) <= baseline_steps * 7 / 10,
                    "{label}: collection/subtitle enrichment must not run for the entire candidate library");
                let mut explain = connection.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
                let plan = explain.query_map(rusqlite::params_from_iter(values.iter()), |row| row.get::<_,String>(3)).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
                println!("{}",serde_json::json!({"query":label,"plan":plan}));
            }
            let connection = store.connect().unwrap();
            let repository = crate::library::LibraryRepository::new(&connection);
            measure("home query counts", || repository.counts().unwrap());
            measure("home query overview counts", || repository.home_overview_counts().unwrap());
            measure("home query collections", || repository.list_home_collections().unwrap());
            measure("home query roots", || repository.list_root_window(4,0).unwrap());
            measure("home query continue", || repository.list_continue_watching(12).unwrap());
            measure("home query continue count", || repository.continue_watching_count().unwrap());
            measure("home query unclassified", || repository.list_unclassified(24).unwrap());
            measure("home query recent", || repository.list_recently_added(5).unwrap());
        }
        service.get_home().unwrap();
        let home = measure(&format!("overview {count} home"), || service.get_home().unwrap());
        assert_eq!((home.total_project_count,home.collection_count,home.folder_count), (count,count*2,count));
        assert_eq!(home.collection_item_count,count*2);
        assert_eq!((home.collections.len(),home.folders.len()),(4,4));
        assert!(home.collections.iter().all(|item| item.item_count == 1));
        assert!(home.folders.iter().all(|item| item.item_count == 1));
        for linked in [false,true] {
            let input = CollectionOverviewInput { root_linked: linked, query: String::new(), page: OverviewPageInput { offset:0,expected_snapshot_token:None } };
            service.collection_overview_page(input.clone()).unwrap();
            let first = measure(&format!("overview {count} collections linked={linked} first"), || service.collection_overview_page(input.clone()).unwrap());
            assert_eq!(first.page.total_count,count);
            assert_eq!(first.page.items.len(),24);
            let last_offset = ((count-1)/24)*24;
            let last_input = CollectionOverviewInput { page: OverviewPageInput { offset:last_offset, expected_snapshot_token:Some(first.page.snapshot_token.clone()) }, ..input.clone() };
            let last = measure(&format!("overview {count} collections linked={linked} last"), || service.collection_overview_page(last_input.clone()).unwrap());
            assert_eq!(last.page.items.len(),(count-last_offset) as usize);
            assert_eq!(last.page.next_offset,None);
            assert_eq!(last.page.snapshot_token,first.page.snapshot_token);
            assert!(last.page.items.iter().all(|item| item.item_count == 1));
            for (query, expected) in [("Synthetic 000",100),("absent",0)] {
                let search_input = CollectionOverviewInput { query:query.to_owned(), ..input.clone() };
                let results = measure(&format!("overview {count} collections linked={linked} query={query}"), || service.collection_overview_page(search_input.clone()).unwrap());
                assert_eq!(results.page.total_count,expected);
                assert_eq!(results.page.items.len(),expected.min(24) as usize);
            }
        }
        let input = OverviewPageInput { offset:0,expected_snapshot_token:None };
        service.root_overview_page(input.clone()).unwrap();
        let first = measure(&format!("overview {count} roots first"), || service.root_overview_page(input.clone()).unwrap());
        assert_eq!(first.page.total_count,count);
        assert_eq!(first.page.items.len(),24);
        let last_offset = ((count-1)/24)*24;
        let input = OverviewPageInput { offset:last_offset, expected_snapshot_token:Some(first.page.snapshot_token.clone()) };
        let last = measure(&format!("overview {count} roots last"), || service.root_overview_page(input.clone()).unwrap());
        assert_eq!(last.page.items.len(),(count-last_offset) as usize);
        assert_eq!(last.page.next_offset,None);
        assert_eq!(last.page.snapshot_token,first.page.snapshot_token);
        assert!(last.page.items.iter().all(|item| item.item_count == 1 && item.availability == "offline"));
    }
}
