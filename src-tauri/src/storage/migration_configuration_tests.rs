use super::*;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[test]
fn resource_configuration_moves_only_declared_contained_paths() {
    for external in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("app");
        let destination = directory.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
        let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
        let parent = if external {
            directory.path().join("external")
        } else {
            root.join("components")
        };
        let resource = parent.join("SiaoVPlay");
        fs::create_dir_all(resource.join("models")).unwrap();
        fs::write(resource.join("models/fixture.bin"), b"resource fixture").unwrap();
        let config = json!({"schemaVersion":1,"selectedParent":parent,"resourceRoot":resource,"preferredProfile":"standard","activeResources":{},"legacyCandidateRoots":[],"proxyUrl":null,"note":root.to_string_lossy()});
        let legacy =
            json!({"storageRoot":resource,"preferredModel":"base","note":root.to_string_lossy()});
        let bytes = serde_json::to_vec(&config).unwrap();
        fs::write(root.join("local-resources.json"), &bytes).unwrap();
        fs::write(
            root.join("runtime-settings.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        let task = prepare(
            &manager,
            StorageArea::AppData,
            &destination,
            StorageMigrationMode::Copy,
        );
        manager
            .start_migration(
                store.database_path().to_path_buf(),
                StartStorageMigrationInput {
                    task_id: task.id.clone(),
                    confirmed: true,
                },
            )
            .unwrap();
        let result = wait_for_task(&manager, &task.id);
        assert_eq!(
            result.status,
            StorageMigrationStatus::RestartRequired,
            "{:?}",
            result.error_message
        );
        let moved_bytes = fs::read(destination.join("local-resources.json")).unwrap();
        let moved: Value = serde_json::from_slice(&moved_bytes).unwrap();
        let expected = if external {
            resource.clone()
        } else {
            destination.join("components/SiaoVPlay")
        };
        assert_eq!(Path::new(moved["resourceRoot"].as_str().unwrap()), expected);
        assert_eq!(
            Path::new(moved["selectedParent"].as_str().unwrap()),
            expected.parent().unwrap()
        );
        assert_eq!(moved["note"], config["note"]);
        assert_eq!(
            fs::read(expected.join("models/fixture.bin")).unwrap(),
            b"resource fixture"
        );
        let runtime: Value =
            serde_json::from_slice(&fs::read(destination.join("runtime-settings.json")).unwrap())
                .unwrap();
        assert_eq!(
            Path::new(runtime["storageRoot"].as_str().unwrap()),
            expected
        );
        assert_eq!(runtime["preferredModel"], "base");
        assert_eq!(runtime["note"], legacy["note"]);
        assert_eq!(fs::read(root.join("local-resources.json")).unwrap(), bytes);
        if external {
            assert_eq!(moved_bytes, bytes);
        } else {
            let receipt: Value = serde_json::from_slice(
                &fs::read(root.join(format!("storage-migration.{}.receipt.json", task.id)))
                    .unwrap(),
            )
            .unwrap();
            let file = receipt["files"]
                .as_array()
                .unwrap()
                .iter()
                .find(|file| file["relative"] == "local-resources.json")
                .unwrap();
            assert_eq!(file["kind"], "rewritten_configuration");
            assert_eq!(
                file["sha256"],
                format!("{:x}", Sha256::digest(&moved_bytes))
            );
        }
        drop(store);
        drop(manager);
        assert_eq!(
            StorageManager::initialize(&root, root.clone(), None)
                .unwrap()
                .app_data_root()
                .unwrap(),
            dunce::canonicalize(&destination).unwrap()
        );
    }
}

#[test]
fn unsupported_or_pending_resource_state_does_not_commit_app_data_move() {
    for fault in ["future", "activation", "removal"] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("app");
        let destination = directory.path().join("destination");
        fs::create_dir(&destination).unwrap();
        let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
        let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
        let file = if fault == "future" {
            "local-resources.json".to_owned()
        } else {
            format!("resource-{fault}.json")
        };
        let bytes = if fault == "future" {
            serde_json::to_vec(&json!({"schemaVersion":999,"selectedParent":root,"resourceRoot":root.join("SiaoVPlay"),"preferredProfile":"standard","activeResources":{},"legacyCandidateRoots":[],"proxyUrl":null})).unwrap()
        } else {
            b"pending record".to_vec()
        };
        fs::write(root.join(&file), &bytes).unwrap();
        let task = prepare(
            &manager,
            StorageArea::AppData,
            &destination,
            StorageMigrationMode::Copy,
        );
        manager
            .start_migration(
                store.database_path().to_path_buf(),
                StartStorageMigrationInput {
                    task_id: task.id.clone(),
                    confirmed: true,
                },
            )
            .unwrap();
        assert_eq!(
            wait_for_task(&manager, &task.id).status,
            StorageMigrationStatus::Failed,
            "{fault}"
        );
        assert!(
            manager
                .get_settings()
                .unwrap()
                .pending_app_data_root
                .is_none()
        );
        assert_eq!(fs::read(root.join(&file)).unwrap(), bytes);
    }
}
