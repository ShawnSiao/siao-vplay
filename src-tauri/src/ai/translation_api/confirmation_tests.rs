use super::super::{
    config,
    types::{AiExecutionTarget, AiProtocol, AiProviderId, SaveAiServiceInput},
};
use crate::{translation::fixture::TranslationFixture, translation_dispatch};

#[test]
fn api_confirmation_binds_the_saved_service_revision_and_endpoint() {
    const CHILD: &str = "SIAOVPLAY_TEST_API_TRANSLATION_CONFIRM";
    if std::env::var_os(CHILD).is_none() {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command.args(["--exact", "ai::translation_api::confirmation_tests::api_confirmation_binds_the_saved_service_revision_and_endpoint"])
            .env(CHILD, "1");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        assert!(command.status().unwrap().success());
        return;
    }
    let settings_dir = tempfile::tempdir().unwrap();
    config::initialize_with_memory_credentials(settings_dir.path());
    let settings = config::store()
        .unwrap()
        .save(SaveAiServiceInput {
            expected_revision: 0,
            id: None,
            provider_id: AiProviderId::Custom,
            protocol: AiProtocol::OpenaiChatCompletions,
            display_name: "Fixture".into(),
            base_url: Some("https://first.example.invalid/v1".into()),
            model_id: Some("model-a".into()),
            api_key: Some("fixture-only".into()),
        })
        .unwrap();
    let service = &settings.services[0];
    let fixture = TranslationFixture::new();
    let task = super::prepare(
        &fixture.store,
        super::PrepareInput {
            project_id: fixture.project_id,
            source_language_code: "ja".into(),
            target_language_code: "zh-cn".into(),
            segment_ids: None,
            execution: AiExecutionTarget::Api {
                service_config_id: service.id.clone(),
                model_id: "model-a".into(),
            },
            service_revision: service.revision,
        },
    )
    .unwrap();
    let preview =
        serde_json::to_value(translation_dispatch::preview(&fixture.store, &task.id).unwrap())
            .unwrap();
    assert_eq!(preview["receiver"], "https://first.example.invalid/v1");
    assert_eq!(preview["model"], "model-a");
    let hash = preview["confirmationSha256"].as_str().unwrap();
    translation_dispatch::verify_api(&fixture.store, &task.id, hash).unwrap();
    assert!(translation_dispatch::verify(&fixture.store, &task.id, hash).is_err());
    config::store()
        .unwrap()
        .save(SaveAiServiceInput {
            expected_revision: settings.revision,
            id: Some(service.id.clone()),
            provider_id: AiProviderId::Custom,
            protocol: AiProtocol::OpenaiChatCompletions,
            display_name: "Fixture".into(),
            base_url: Some("https://second.example.invalid/v1".into()),
            model_id: Some("model-b".into()),
            api_key: None,
        })
        .unwrap();
    assert!(translation_dispatch::verify_api(&fixture.store, &task.id, hash).is_err());
    assert!(
        super::start(
            &fixture.store,
            super::StartInput {
                task_id: task.id,
                confirmation_sha256: hash.into()
            }
        )
        .is_err()
    );
}
