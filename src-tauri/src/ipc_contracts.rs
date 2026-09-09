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
