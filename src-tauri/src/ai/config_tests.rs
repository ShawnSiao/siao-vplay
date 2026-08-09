use std::sync::Arc;

use tempfile::tempdir;

use super::{
    super::{
        credentials::{CredentialStore, tests_support::MemoryCredentialStore},
        error::AiError,
        types::{AiProtocol, AiProviderId, CredentialState, SaveAiServiceInput},
    },
    AiServiceStore, SETTINGS_FILE_NAME, normalize_endpoint,
};

fn save_input(revision: u64) -> SaveAiServiceInput {
    SaveAiServiceInput {
        expected_revision: revision,
        id: None,
        provider_id: AiProviderId::Openai,
        display_name: "OpenAI".to_owned(),
        protocol: AiProtocol::OpenaiResponses,
        base_url: None,
        model_id: None,
        api_key: Some("test-secret".to_owned()),
    }
}

#[test]
fn saves_metadata_atomically_without_persisting_the_api_key() {
    let data = tempdir().expect("tempdir");
    let credentials = Arc::new(MemoryCredentialStore::default());
    let store = AiServiceStore::new(data.path().join(SETTINGS_FILE_NAME), credentials.clone());
    let snapshot = store.save(save_input(0)).expect("save");
    assert_eq!(snapshot.revision, 1);
    assert_eq!(
        snapshot.services[0].credential_state,
        CredentialState::Stored
    );
    let contents = std::fs::read_to_string(data.path().join(SETTINGS_FILE_NAME)).expect("file");
    assert!(!contents.contains("test-secret"));
    assert_eq!(
        credentials
            .read(&snapshot.services[0].id)
            .expect("credential"),
        Some("test-secret".to_owned())
    );
}

#[test]
fn rejects_stale_revisions_and_unsafe_remote_http() {
    let data = tempdir().expect("tempdir");
    let store = AiServiceStore::new(
        data.path().join(SETTINGS_FILE_NAME),
        Arc::new(MemoryCredentialStore::default()),
    );
    store.save(save_input(0)).expect("first save");
    assert!(matches!(
        store.save(save_input(0)),
        Err(AiError::RevisionConflict)
    ));
    assert!(normalize_endpoint("http://api.example.com/v1").is_err());
    assert!(normalize_endpoint("http://127.0.0.1:11434/v1").is_ok());
}
