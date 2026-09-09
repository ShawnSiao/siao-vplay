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
    check_transcription_schema();
    check_subtitle_body_schema();
    check_translation_schemas();
    check_schema("subtitle-burn-job", &serialized_schema::<crate::burn::SubtitleBurnJob>());
    check_schema("explanation-task", &serialized_schema::<crate::understanding::ExplanationTask>());
    check_schema("explanation", &serialized_schema::<crate::understanding::Explanation>());
    check_schema("explanation-application", &serialized_schema::<crate::understanding::ExplanationApplication>());
    check_schema("learning-task", &serialized_schema::<crate::learning::LearningTask>());
    check_schema("learning-application", &serialized_schema::<crate::learning::LearningApplication>());
    check_schema("dictionary-entry", &serialized_schema::<crate::learning::DictionaryEntry>());
    check_schema("video-summary", &serialized_schema::<crate::summary::VideoSummary>());
    check_schema("summary-task", &serialized_schema::<crate::summary::SummaryTask>());
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
    use crate::ai::types::{AiExecutionTarget, AiMaterialAuthorization, PreviewAiExecutionInput};
    let mut request = serialized_schema::<PreviewAiExecutionInput>();
    request["examples"] = serde_json::json!([
        PreviewAiExecutionInput { execution: AiExecutionTarget::Manual,
            authorization: AiMaterialAuthorization { subtitles: true, current_question: true, frames: false, service_revision: None } },
        PreviewAiExecutionInput { execution: AiExecutionTarget::Codex,
            authorization: AiMaterialAuthorization { subtitles: true, current_question: true, frames: true, service_revision: None } },
        PreviewAiExecutionInput { execution: AiExecutionTarget::Api { service_config_id: "service".into(), model_id: "model".into() },
            authorization: AiMaterialAuthorization { subtitles: true, current_question: true, frames: false, service_revision: Some(7) } },
    ]);
    check_schema("ai-execution-request", &request);
    use crate::ai::dispatch::{TaskDispatchPreview, DispatchSubtitle, DispatchFrame, DispatchPrompt};
    let mut dispatch = serialized_schema::<TaskDispatchPreview>();
    dispatch["examples"] = serde_json::json!([TaskDispatchPreview {
        task_id: "task".into(), task_kind: crate::verified_task_files::TaskDomain::Explanation,
        confirmation_sha256: "a".repeat(64), execution: AiExecutionTarget::Codex,
        authorization: AiMaterialAuthorization { subtitles: true, current_question: true, frames: true, service_revision: None },
        receiver: "OpenAI（经本机 Codex）".into(), endpoint: None, model: "Codex 默认模型".into(),
        subtitles: vec![DispatchSubtitle { version_id: "version".into(), version_number: 1, role: "original".into(), language: "ja".into() }],
        subtitle_count: 1, playback_cutoff_ms: 1000, selected_text: None,
        prompt: Some(DispatchPrompt { template: "模板".into(), requirements: "".into(), one_time_requirements: "".into() }),
        frames: vec![DispatchFrame { id: "frame".into(), timestamp_ms: 900, sha256: "b".repeat(64) }],
    }]);
    check_schema("task-dispatch-preview", &dispatch);
    let mut summary = serialized_schema::<crate::summary::SummaryDispatchPreview>();
    summary["examples"] = serde_json::json!([crate::summary::dispatch_contract_example()]);
    check_schema("summary-dispatch-preview", &summary);
    let mut translation = serialized_schema::<crate::translation_dispatch::TranslationDispatchPreview>();
    translation["examples"] = serde_json::json!([crate::translation_dispatch::dispatch_contract_example()]);
    check_schema("translation-dispatch-preview", &translation);
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

fn check_transcription_schema() {
    use crate::transcription::{TranscriptionJob, TranscriptionLanguage, TranscriptionModelKind};
    let mut schema = serialized_schema::<TranscriptionJob>();
    let mut examples = Vec::new();
    for status in ["queued", "extracting", "transcribing", "validating", "completed", "failed", "cancelled", "interrupted"] {
        for language in [TranscriptionLanguage::Auto, TranscriptionLanguage::En, TranscriptionLanguage::Th, TranscriptionLanguage::Ja, TranscriptionLanguage::Ko] {
            examples.push(serde_json::to_value(TranscriptionJob {
                id: "job".into(), project_id: "project".into(), status: serde_json::from_value(serde_json::json!(status)).unwrap(),
                stage: status.into(), progress: if status == "completed" { 1.0 } else { 0.0 }, language_code: language,
                model_kind: if language == TranscriptionLanguage::Auto { TranscriptionModelKind::Base } else { TranscriptionModelKind::Small },
                runtime_backend: serde_json::from_value(serde_json::json!(if language == TranscriptionLanguage::Auto { "vulkan" } else { "cpu" })).unwrap(),
                runtime_version: "test".into(), subtitle_version_id: if status == "completed" { Some("version".into()) } else { None },
                error_code: None, error_message: None, created_at_ms: 1, updated_at_ms: 2,
                started_at_ms: if status == "queued" { None } else { Some(1) },
                completed_at_ms: if status == "completed" { Some(2) } else { None },
            }).unwrap());
        }
    }
    schema["examples"] = examples.into();
    check_schema("transcription-job", &schema);
}

fn check_subtitle_body_schema() {
    use crate::subtitles::*;
    let mut schema = serialized_schema::<SubtitleVersion>();
    let example = subtitle_body_example();
    let mut examples = Vec::new();
    for role in ["original", "translation"] {
        for status in ["draft", "ready", "rejected"] {
            for source in ["imported_file", "embedded", "transcription", "agent_translation"] {
                let mut sample = example.clone();
                sample.role = role.into(); sample.status = status.into(); sample.source_kind = source.into();
                examples.push(serde_json::to_value(sample).unwrap());
            }
        }
    }
    schema["examples"] = examples.into();
    check_schema("subtitle-version", &schema);
}

fn subtitle_body_example() -> crate::subtitles::SubtitleVersion {
    use crate::subtitles::*;
    crate::subtitles::SubtitleVersion {
        id: "v".into(), track_id: "track".into(), project_id: "p".into(), role: "original".into(),
        version_number: 1, status: "draft".into(), source_kind: "transcription".into(), source_label: "Test".into(),
        source_sha256: "a".repeat(64), media_sha256: "b".repeat(64), language_code: "en".into(), project_revision: 2,
        parent_version_id: None, source_task_id: Some("task".into()), created_at_ms: 1, is_current: true,
        preflight: SubtitlePreflightReport { status: SubtitlePreflightStatus::Ready, segment_count: 1, error_count: 0, warning_count: 0,
            first_start_ms: Some(0), last_end_ms: Some(1000), media_duration_ms: Some(2000), coverage_ratio: Some(0.5), issues: vec![] },
        segments: vec![SubtitleSegment { id: "segment".into(), lineage_id: "lineage".into(), source_segment_id: None,
            ordinal: 0, start_ms: 0, end_ms: 1000, text: "Hello".into(), confidence: None, issue_kind: None,
            words: vec![SubtitleWord { ordinal: 0, start_ms: 0, end_ms: 500, text: "Hello".into(), confidence: Some(0.9) }] }],
    }
}

fn check_translation_schemas() {
    use crate::translation::{TranslationApplication, TranslationTask, TranslationValidation};
    let validation = TranslationValidation { status: "accepted".into(), translation_count: 1, warning_count: 0, warnings: vec![] };
    let mut task = TranslationTask {
        id: "task".into(), project_id: "p".into(), task_type: "subtitle_translation".into(), handoff_kind: "manual".into(),
        protocol_version: "siaovplay-agent-v1".into(), status: "completed".into(), stage: "completed".into(), progress: 1.0,
        receiver_label: "Test".into(), material_scope: vec!["字幕".into()], source_version_id: "source".into(),
        source_language_code: "en".into(), target_language_code: "zh-cn".into(), authorized_segment_ids: vec!["segment".into()],
        segment_count: 1, expected_project_revision: 1, base_translation_version_id: None, output_version_id: Some("v".into()),
        validation: Some(validation.clone()), error_code: None, error_message: None, created_at_ms: 1, updated_at_ms: 2,
        started_at_ms: Some(1), completed_at_ms: Some(2),
    };
    let mut body = subtitle_body_example();
    body.role = "translation".into(); body.source_kind = "agent_translation".into(); body.language_code = "zh-cn".into();
    body.segments[0].source_segment_id = Some("segment".into());
    let mut application = serialized_schema::<TranslationApplication>();
    application["examples"] = serde_json::json!([TranslationApplication { task: task.clone(), subtitle_version: body, validation }]);
    check_schema("translation-application", &application);
    let mut schema = serialized_schema::<TranslationTask>();
    let mut examples = Vec::new();
    for status in ["awaiting_external_result", "queued", "running", "validating", "completed", "failed", "cancelled", "interrupted"] {
        for handoff in ["manual", "codex", "api"] {
            task.status = status.into(); task.handoff_kind = handoff.into();
            examples.push(serde_json::to_value(&task).unwrap());
        }
    }
    schema["examples"] = examples.into();
    check_schema("translation-task", &schema);
}
