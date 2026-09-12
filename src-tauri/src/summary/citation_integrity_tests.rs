use super::*;
use std::fs;
use super::super::{task_repository::SummaryTaskRepository, test_support::prepared_summary};

#[test]
fn historical_citations_use_verified_task_materials_and_disclose_missing_proof() {
    let (_directory, store, task) = prepared_summary();
    let tasks = SummaryTaskRepository::new(&store);
    tasks.set_task_state(&task.id, "validating", "validating", 0.9).unwrap();
    let result = serde_json::from_value(serde_json::json!({
        "title": "report", "overview": "retained report",
        "coreConcepts": [{"title": "concept", "body": "claim", "evidence": [{
            "kind": "video_statement", "claim": "original evidence", "subtitleIds": ["past"]
        }]}]
    })).unwrap();
    let reports = SummaryResultRepository::new(&store);
    let saved = reports.save_summary(&task.id, &result, false).unwrap();
    assert_eq!(saved.result.core_concepts[0].evidence[0].citations[0].excerpt, "past");
    let root = tasks.materials_directory(&task.id);
    let mut segments: serde_json::Value = serde_json::from_slice(&fs::read(root.join("subtitles.json")).unwrap()).unwrap();
    segments[0]["text"] = serde_json::json!("replacement from another revision");
    segments[0]["startMs"] = serde_json::json!(900_000);
    segments[0]["endMs"] = serde_json::json!(901_000);
    fs::write(root.join("subtitles.json"), serde_json::to_vec(&segments).unwrap()).unwrap();
    let read = reports.get_summary(&saved.id).unwrap();
    let citation = &read.result.core_concepts[0].evidence[0].citations[0];
    assert_eq!(citation.excerpt, "past");
    assert_eq!(citation.start_ms, 0);
    fs::write(root.join("manifest.json"), b"{}").unwrap();
    let unavailable = reports.get_summary(&saved.id).unwrap();
    assert_eq!(unavailable.result.overview, "retained report");
    assert!(unavailable.result.core_concepts[0].evidence[0].citations.is_empty());
}
