use super::{
    task_repository::SummaryTaskRepository, test_support::prepared_summary, verified_materials,
};
use crate::{storage::*, store::ProjectStore};
use std::{
    fs,
    path::Path,
    thread,
    time::{Duration, Instant},
};

#[test]
fn failed_summary_materials_remain_verified_after_data_migration() {
    verify_relocation(false);
}

#[test]
fn visual_summary_materials_remain_verified_after_data_migration() {
    verify_relocation(true);
}

fn verify_relocation(visual: bool) {
    let (_temporary, store, mut task) = prepared_summary();
    if visual {
        seed_visual_material(&store, &task);
        task = SummaryTaskRepository::new(&store).get(&task.id).unwrap();
    }
    let repository = SummaryTaskRepository::new(&store);
    repository
        .fail(
            &task.id,
            "fixture_interruption",
            "isolated recovery fixture",
        )
        .unwrap();
    let original_manifest =
        fs::read(Path::new(&task.materials_directory).join("manifest.json")).unwrap();
    let source = store.data_directory().to_path_buf();
    let destination = source.parent().unwrap().join("relocated");
    fs::create_dir(&destination).unwrap();
    let manager = StorageManager::initialize(&source, source.clone(), None).unwrap();
    let migration = manager
        .prepare_migration(PrepareStorageMigrationInput {
            area: StorageArea::AppData,
            destination_directory: destination.to_string_lossy().into(),
            mode: StorageMigrationMode::Copy,
        })
        .unwrap();
    manager
        .start_migration(
            store.database_path().to_path_buf(),
            StartStorageMigrationInput {
                task_id: migration.id.clone(),
                confirmed: true,
            },
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let current = manager.get_migration(&migration.id).unwrap();
        if !matches!(
            current.status,
            StorageMigrationStatus::Prepared | StorageMigrationStatus::Running
        ) {
            assert_eq!(
                current.status,
                StorageMigrationStatus::RestartRequired,
                "{:?}",
                current.error_message
            );
            break;
        }
        assert!(Instant::now() < deadline, "migration did not finish");
        thread::sleep(Duration::from_millis(10));
    }
    drop(manager);
    let restarted = StorageManager::initialize(&source, source.clone(), None).unwrap();
    let moved_store = ProjectStore::open(
        restarted
            .app_data_root()
            .unwrap()
            .join("projects/siaovplay.db"),
    )
    .unwrap();
    let moved = SummaryTaskRepository::new(&moved_store)
        .get(&task.id)
        .unwrap();
    assert_eq!(moved.status, "failed");
    assert!(Path::new(&moved.materials_directory).starts_with(&destination));
    assert_eq!(
        fs::read(Path::new(&moved.materials_directory).join("manifest.json")).unwrap(),
        original_manifest
    );
    let materials = verified_materials::load(&moved_store, &moved).unwrap();
    assert_eq!(materials.segments.len(), 1);
    assert_eq!(materials.segments[0].text, "past");
    if visual {
        assert_eq!(materials.frames.len(), 1);
        assert_eq!(
            materials.frames[0].metadata.relative_path,
            "frames/frame-001.jpg"
        );
        assert_eq!(materials.frames[0].bytes.as_slice(), b"synthetic frame");
        let frame = Path::new(&moved.materials_directory).join("frames/frame-001.jpg");
        fs::write(&frame, b"modified frame").unwrap();
        assert!(verified_materials::load(&moved_store, &moved).is_err());
        assert_eq!(
            fs::read(Path::new(&task.materials_directory).join("frames/frame-001.jpg")).unwrap(),
            b"synthetic frame"
        );
    } else {
        assert!(materials.frames.is_empty());
    }
    assert_eq!(
        moved.material_manifest_sha256,
        task.material_manifest_sha256
    );
    assert_eq!(
        fs::read(Path::new(&task.materials_directory).join("manifest.json")).unwrap(),
        original_manifest
    );
}

pub(super) fn seed_visual_material(store: &ProjectStore, task: &super::model::SummaryTask) {
    use sha2::{Digest, Sha256};
    let directory = Path::new(&task.materials_directory);
    fs::create_dir_all(directory.join("frames")).unwrap();
    fs::write(directory.join("frames/frame-001.jpg"), b"synthetic frame").unwrap();
    let frame = super::keyframes::SummaryFrame {
        id: "frame-001".into(),
        ordinal: 0,
        timestamp_ms: 50,
        relative_path: "frames/frame-001.jpg".into(),
        sha256: format!("{:x}", Sha256::digest(b"synthetic frame")),
    };
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(directory.join("manifest.json")).unwrap()).unwrap();
    // Isolated prepared-state fixture; no image extraction or external authorization is exercised.
    manifest["visualMaterialAuthorized"] = true.into();
    manifest["frameTimestampsMs"] = serde_json::json!([50]);
    let bytes = serde_json::to_vec(&manifest).unwrap();
    fs::write(directory.join("manifest.json"), &bytes).unwrap();
    let connection = store.connect().unwrap();
    connection.execute("UPDATE summary_tasks SET visual_material_authorized=1, material_manifest_sha256=?2 WHERE id=?1", rusqlite::params![task.id, format!("{:x}", Sha256::digest(&bytes))]).unwrap();
    connection
        .execute(
            "UPDATE summary_chunks SET frame_manifest_json=?2 WHERE task_id=?1 AND ordinal=0",
            rusqlite::params![task.id, serde_json::to_string(&vec![frame]).unwrap()],
        )
        .unwrap();
}
