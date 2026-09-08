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
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../contracts/media-preparation-progress.schema.json");
    let expected = format!("{}\n", serde_json::to_string_pretty(&schema).unwrap());
    if std::env::var("SIAOVPLAY_UPDATE_CONTRACTS").as_deref() == Ok("1") {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, &expected).unwrap();
    }
    let actual = fs::read_to_string(&path).expect("Run npm run contracts:generate to create contracts");
    assert_eq!(actual.replace("\r\n", "\n"), expected,
        "Rust IPC schema changed; run npm run contracts:generate and review the diff");
}
