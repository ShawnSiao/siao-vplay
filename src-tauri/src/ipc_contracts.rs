use crate::preparation::{Snapshot, Stage, Status};
use std::{fs, path::Path};

// Rust wire types and their serde attributes are the contract source.
#[test]
fn committed_schemas_match_rust() {
    let mut schema = serde_json::to_value(schemars::schema_for!(Snapshot)).unwrap();
    let mut examples = Vec::new();
    for stage in [Stage::Queued, Stage::Runtime, Stage::Fingerprint, Stage::Inspect,
        Stage::Transcode, Stage::Validate, Stage::Finalize] {
        for status in [Status::Running, Status::Cancelling, Status::Completed,
            Status::Cancelled, Status::Failed] {
            examples.push(serde_json::to_value(Snapshot {
                request_id: "request-1".into(), project_id: "project-1".into(), stage, status,
            }).unwrap());
        }
    }
    schema["examples"] = examples.into();
    check_schema("media-preparation-progress", &schema);
    use crate::subtitles::metadata::{SubtitleVersionMetadata, SubtitleTrackRole, SubtitleRevisionStatus};
    let mut metadata = serde_json::to_value(schemars::schema_for!(SubtitleVersionMetadata)).unwrap();
    metadata["examples"] = serde_json::json!([SubtitleVersionMetadata {
        id: "v".into(), track_id: "t".into(), project_id: "p".into(), role: SubtitleTrackRole::Original,
        version_number: 1, status: SubtitleRevisionStatus::Ready, source_label: "字幕".into(),
        language_code: "en".into(), created_at_ms: 1, is_current: true, segment_count: 75,
    }]);
    check_schema("subtitle-version-metadata", &metadata);
    use crate::ai::types::{AiModelInfo, AiModelList};
    let mut models = serde_json::to_value(schemars::schema_for!(AiModelList)).unwrap();
    models["examples"] = serde_json::json!([
        AiModelList { models: Vec::new(), manual_entry_allowed: true },
        AiModelList { models: vec![AiModelInfo {
            id: "model".into(), display_name: "Model".into(), vision: false,
            capability_source: "unknown".into(),
        }], manual_entry_allowed: true },
    ]);
    check_schema("ai-model-list", &models);
    use crate::ai::types::NetworkSettings;
    // Output contracts require nullable fields that Serde always emits.
    let generator = schemars::generate::SchemaSettings::draft2020_12().for_serialize().into_generator();
    let mut network = serde_json::to_value(generator.into_root_schema_for::<NetworkSettings>()).unwrap();
    network["examples"] = serde_json::json!([
        NetworkSettings { schema_version: 1, revision: 0, custom_proxy_url: None,
            effective_mode: "direct".into(), effective_source: "direct".into(), effective_proxy_address: None },
        NetworkSettings { schema_version: 1, revision: 7, custom_proxy_url: Some("http://127.0.0.1:7890".into()),
            effective_mode: "custom".into(), effective_source: "custom".into(), effective_proxy_address: Some("127.0.0.1:7890".into()) },
    ]);
    check_schema("network-settings", &network);
    check_ai_service_schemas();
    use crate::ai::types::{AiExecutionKind, AiExecutionPreview};
    let mut preview = serialized_schema::<AiExecutionPreview>();
    preview["examples"] = serde_json::json!([
        AiExecutionPreview { execution_kind: AiExecutionKind::Codex, service_config_id: None, provider_id: None,
            display_name: "本机 Codex".into(), model_id: None, subtitles: true, current_question: true,
            frames_requested: false, frames_effective: false, service_revision: None },
        AiExecutionPreview { execution_kind: AiExecutionKind::Api, service_config_id: Some("service".into()), provider_id: Some(crate::ai::types::AiProviderId::Openai),
            display_name: "Test".into(), model_id: Some("model".into()), subtitles: true, current_question: true,
            frames_requested: false, frames_effective: false, service_revision: Some(7) },
    ]);
    check_schema("ai-execution-preview", &preview);
}

fn serialized_schema<T: schemars::JsonSchema>() -> serde_json::Value {
    serde_json::to_value(schemars::generate::SchemaSettings::draft2020_12()
        .for_serialize().into_generator().into_root_schema_for::<T>()).unwrap()
}

fn check_ai_service_schemas() {
    use crate::ai::types::*;
    let catalog: AiProviderCatalog = serde_json::from_str(include_str!("../resources/ai-provider-catalog.json")).unwrap();
    let capabilities = AiServiceCapabilities { understanding: true, learning: true, vision: false };
    let mut settings = serialized_schema::<AiServiceSettings>();
    settings["examples"] = serde_json::json!([
        AiServiceSettings { schema_version: 1, revision: 0, provider_catalog: catalog.clone(), services: vec![], default_service_id: None },
        AiServiceSettings { schema_version: 1, revision: 7, provider_catalog: catalog,
            services: vec![AiServiceSummary { id: "service".into(), provider_id: AiProviderId::Openai,
                display_name: "Test".into(), protocol: AiProtocol::OpenaiResponses, base_url: "https://example.invalid/v1".into(),
                model_id: Some("model".into()), credential_state: CredentialState::Stored, connection_state: ConnectionState::Ready,
                capabilities: capabilities.clone(), is_default: true, revision: 7 }], default_service_id: Some("service".into()) },
    ]);
    check_schema("ai-service-settings", &settings);
    let mut result = serialized_schema::<AiServiceTestResult>();
    result["examples"] = serde_json::json!([
        AiServiceTestResult { state: ConnectionState::Ready, models: vec![], selected_model_id: None,
            capabilities: capabilities.clone(), minimal_request_used: false, may_incur_usage: false, provider_request_id: None },
        AiServiceTestResult { state: ConnectionState::Ready, models: vec![AiModelInfo { id: "model".into(), display_name: "Model".into(), vision: false, capability_source: "unknown".into() }],
            selected_model_id: Some("model".into()), capabilities, minimal_request_used: true, may_incur_usage: true, provider_request_id: Some("request".into()) },
    ]);
    check_schema("ai-service-test-result", &result);
}

fn check_schema(name: &str, schema: &serde_json::Value) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../contracts/{name}.schema.json"));
    let expected = format!("{}\n", serde_json::to_string_pretty(&schema).unwrap());
    if std::env::var("SIAOVPLAY_UPDATE_CONTRACTS").as_deref() == Ok("1") {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, &expected).unwrap();
    }
    let actual = fs::read_to_string(&path).expect("Run npm run contracts:generate to create contracts");
    assert_eq!(actual.replace("\r\n", "\n"), expected,
        "Rust IPC schema changed; run npm run contracts:generate and review the diff");
}
