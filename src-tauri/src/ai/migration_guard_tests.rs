use std::{fs, sync::Arc, thread, time::Duration};
use super::{config::AiServiceStore, network::NetworkStore,
    credentials::{CredentialStore, tests_support::MemoryCredentialStore}, types::*};
use crate::{storage::*, store::ProjectStore};

#[test]
fn migration_freezes_ai_config_and_credentials_until_restart() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let db = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let credentials = Arc::new(MemoryCredentialStore::default());
    let service_path = root.join("ai-services.json");
    let network_path = root.join("network-settings.json");
    let services = AiServiceStore::new(service_path.clone(), credentials.clone()).with_storage(manager.clone());
    let network = NetworkStore::new(network_path.clone()).with_storage(manager.clone());
    let input = || SaveAiServiceInput { expected_revision: 0, id: None,
        provider_id: AiProviderId::Openai, display_name: "Test".into(),
        protocol: AiProtocol::OpenaiResponses, base_url: None, model_id: None, api_key: Some("original".into()) };
    let snapshot = services.save(input()).unwrap();
    let id = snapshot.services[0].id.clone();
    network.set(SetNetworkSettingsInput { expected_revision: 0, custom_proxy_url: None }).unwrap();
    let service_bytes = fs::read(&service_path).unwrap();
    let network_bytes = fs::read(&network_path).unwrap();
    let task = manager.prepare_migration(PrepareStorageMigrationInput { area: StorageArea::AppData,
        mode: StorageMigrationMode::Copy, destination_directory: destination.to_string_lossy().into_owned() }).unwrap();
    manager.start_migration(db.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true }).unwrap();
    for _ in 0..300 {
        if manager.get_migration(&task.id).unwrap().status != StorageMigrationStatus::Running { break; }
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(manager.get_migration(&task.id).unwrap().status, StorageMigrationStatus::RestartRequired);
    let mut edit = input(); edit.expected_revision = 1; edit.id = Some(id.clone()); edit.api_key = Some("replacement".into());
    assert!(services.save(edit).is_err(), "late save must be rejected before credentials change");
    assert!(services.delete(DeleteAiServiceInput { expected_revision: 1, id: id.clone() }).is_err());
    assert!(services.set_default(SetDefaultAiServiceInput { expected_revision: 1, id: Some(id.clone()) }).is_err());
    assert!(services.mark_connection_ready(&id, Some("late-probe-model")).is_err());
    assert!(network.set(SetNetworkSettingsInput { expected_revision: 1, custom_proxy_url: Some("http://127.0.0.1:1234".into()) }).is_err());
    assert!(network.set_compat(Some("http://127.0.0.1:1234")).is_err());
    assert_eq!(fs::read(service_path).unwrap(), service_bytes);
    assert_eq!(fs::read(network_path).unwrap(), network_bytes);
    assert_eq!(credentials.read(&id).unwrap().as_deref(), Some("original"));
    assert_eq!(services.snapshot().unwrap().revision, 1);
    drop(services); drop(network); drop(manager); drop(db);
    let reopened = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let services = AiServiceStore::new(destination.join("ai-services.json"), credentials).with_storage(reopened.clone());
    services.set_default(SetDefaultAiServiceInput { expected_revision: 1, id: Some(id) }).unwrap();
    let network = NetworkStore::new(destination.join("network-settings.json")).with_storage(reopened);
    assert_eq!(network.set(SetNetworkSettingsInput { expected_revision: 1, custom_proxy_url: None }).unwrap().revision, 2);
}

#[test]
fn credential_write_holds_migration_lease_until_config_is_persisted() {
    use std::sync::{mpsc, Mutex};
    struct PausedCredentials {
        inner: MemoryCredentialStore,
        entered: mpsc::Sender<()>,
        release: Mutex<mpsc::Receiver<()>>,
    }
    impl CredentialStore for PausedCredentials {
        fn read(&self, id: &str) -> Result<Option<String>, super::AiError> { self.inner.read(id) }
        fn delete(&self, id: &str) -> Result<(), super::AiError> { self.inner.delete(id) }
        fn write(&self, id: &str, value: &str) -> Result<(), super::AiError> {
            self.entered.send(()).unwrap();
            self.release.lock().unwrap().recv_timeout(Duration::from_secs(10)).unwrap();
            self.inner.write(id, value)
        }
    }
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let db = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let task = manager.prepare_migration(PrepareStorageMigrationInput { area: StorageArea::AppData,
        mode: StorageMigrationMode::Copy, destination_directory: destination.to_string_lossy().into_owned() }).unwrap();
    let (entered, wait) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let services = AiServiceStore::new(root.join("ai-services.json"), Arc::new(PausedCredentials {
        inner: MemoryCredentialStore::default(), entered, release: Mutex::new(resume),
    })).with_storage(manager.clone());
    let worker = thread::spawn(move || services.save(SaveAiServiceInput { expected_revision: 0,
        id: None, provider_id: AiProviderId::Openai, display_name: "Paused".into(),
        protocol: AiProtocol::OpenaiResponses, base_url: None, model_id: None, api_key: Some("isolated".into()) }));
    wait.recv_timeout(Duration::from_secs(10)).unwrap();
    let admission = manager.start_migration(db.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true });
    release.send(()).unwrap();
    let saved = worker.join().unwrap().unwrap();
    assert!(matches!(admission, Err(StorageError::MigrationBusy)));
    assert_eq!(saved.revision, 1);
    manager.start_migration(db.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true }).unwrap();
    for _ in 0..300 {
        if manager.get_migration(&task.id).unwrap().status != StorageMigrationStatus::Running { break; }
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(manager.get_migration(&task.id).unwrap().status, StorageMigrationStatus::RestartRequired);
    assert_eq!(fs::read(root.join("ai-services.json")).unwrap(), fs::read(destination.join("ai-services.json")).unwrap());
}
