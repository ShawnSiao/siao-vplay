use std::{env, fs, path::Path, thread, time::Duration};

use rusqlite::params;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{
    executor, materials,
    model::{
        AnalysisMode, AnalysisScope, EvidenceKind, ExportVideoSummaryInput,
        PrepareSummaryTaskInput, PromptSelection, SummaryEvidence, SummaryExecutionKind,
        SummaryResult, SummarySection,
    },
    report,
    result_model::SummaryGlossaryEntry,
    result_repository::SummaryResultRepository,
    task_repository::SummaryTaskRepository,
};
use crate::{domain::CreateLocalProjectInput, store::ProjectStore};

#[test]
#[ignore = "requires SIAOVPLAY_SUMMARY_MEDIA and an available local FFmpeg runtime"]
fn real_media_exports_a_verified_private_markdown_report() {
    let media_path = env::var("SIAOVPLAY_SUMMARY_MEDIA")
        .expect("SIAOVPLAY_SUMMARY_MEDIA must point to authorized media");
    assert!(Path::new(&media_path).is_file());
    let directory = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(directory.path().join("data/projects/siaovplay.db")).unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: media_path.clone(),
            title: Some(r"架构视频 C:\private\source.mp4".to_owned()),
        })
        .unwrap();
    seed_subtitle(&store, &project.id);
    let task = materials::prepare(
        &store,
        PrepareSummaryTaskInput {
            project_id: project.id,
            scope: AnalysisScope::CurrentProgress,
            playback_cutoff_ms: Some(1_000),
            analysis_mode: AnalysisMode::SoftwareArchitecture,
            execution_kind: SummaryExecutionKind::Manual,
            prompt_selection: PromptSelection::summary_default(),
            visual_material_authorized: false,
            subtitles_authorized: true,
            spoiler_confirmed: false,
            service_config_id: None,
            service_revision: None,
            provider_id: None,
            model_id: None,
        },
    )
    .unwrap();
    let result = summary_result();
    SummaryTaskRepository::new(&store).set_task_state(&task.id, "validating", "validating", 0.9).unwrap();
    let summary = SummaryResultRepository::new(&store)
        .save_summary(&task.id, &result, false)
        .unwrap();
    let output_parent = directory.path().join("reports");
    fs::create_dir(&output_parent).unwrap();
    let exported = report::export(
        &store,
        ExportVideoSummaryInput {
            summary_id: summary.id,
            directory: output_parent.to_string_lossy().into_owned(),
        },
    )
    .unwrap();

    assert!((1..=12).contains(&exported.asset_count));
    let report = fs::read_to_string(&exported.report_path).unwrap();
    assert!(report.contains("## 原理或架构"));
    assert!(report.contains("assets/frame-001.jpg"));
    assert!(!report.contains(&media_path));
    assert!(!report.contains("abcdefghijklmnop"));
    assert!(!report.contains("segment-1"));
    assert!(report.contains("00:00:00–00:00:01 · 1 条字幕"));
    let manifest: Value =
        serde_json::from_slice(&fs::read(&exported.manifest_path).unwrap()).unwrap();
    let root = Path::new(&exported.directory);
    for (relative, expected) in manifest["assets"].as_object().unwrap() {
        assert!(!Path::new(relative).is_absolute());
        let bytes = fs::read(root.join(relative)).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)),
            expected.as_str().unwrap()
        );
    }
}

#[test]
#[ignore = "requires authenticated Codex and SIAOVPLAY_SUMMARY_MEDIA"]
fn real_codex_completes_a_schema_validated_summary() {
    let media_path = env::var("SIAOVPLAY_SUMMARY_MEDIA")
        .expect("SIAOVPLAY_SUMMARY_MEDIA must point to authorized media");
    let directory = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(directory.path().join("data/projects/siaovplay.db")).unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path,
            title: Some("Codex 总结验收".to_owned()),
        })
        .unwrap();
    seed_subtitle(&store, &project.id);
    let task = materials::prepare(
        &store,
        PrepareSummaryTaskInput {
            project_id: project.id,
            scope: AnalysisScope::CurrentProgress,
            playback_cutoff_ms: Some(1_000),
            analysis_mode: AnalysisMode::SoftwareArchitecture,
            execution_kind: SummaryExecutionKind::Codex,
            prompt_selection: PromptSelection::summary_default(),
            visual_material_authorized: false,
            subtitles_authorized: true,
            spoiler_confirmed: false,
            service_config_id: None,
            service_revision: None,
            provider_id: Some("codex".to_owned()),
            model_id: None,
        },
    )
    .unwrap();
    executor::start_or_resume(&store, &task.id).unwrap();
    let repository = SummaryTaskRepository::new(&store);
    for _ in 0..900 {
        let current = repository.get(&task.id).unwrap();
        match current.status.as_str() {
            "completed" => {
                assert!(current.output_summary_id.is_some());
                return;
            }
            "failed" | "cancelled" => panic!(
                "Codex summary ended as {}: {:?} {:?}",
                current.status, current.error_code, current.error_message
            ),
            _ => thread::sleep(Duration::from_secs(1)),
        }
    }
    panic!("Codex summary did not complete within 900 seconds");
}

#[test]
fn manual_handoff_imports_a_schema_valid_result() {
    manual_handoff(false);
}

#[test]
fn cancelled_manual_handoff_cannot_import_a_valid_late_result() {
    manual_handoff(true);
}

fn manual_handoff(cancel_before_import: bool) {
    let directory = tempfile::tempdir().unwrap();
    let media_path = directory.path().join("fixture.mp4");
    fs::write(&media_path, b"authorized fixture").unwrap();
    let store = ProjectStore::open(directory.path().join("data/projects/siaovplay.db")).unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: media_path.to_string_lossy().into_owned(),
            title: Some("手动总结验收".to_owned()),
        })
        .unwrap();
    seed_subtitle(&store, &project.id);
    let task = materials::prepare(
        &store,
        PrepareSummaryTaskInput {
            project_id: project.id,
            scope: AnalysisScope::CurrentProgress,
            playback_cutoff_ms: Some(1_000),
            analysis_mode: AnalysisMode::SoftwareArchitecture,
            execution_kind: SummaryExecutionKind::Manual,
            prompt_selection: PromptSelection::summary_default(),
            visual_material_authorized: false,
            subtitles_authorized: true,
            spoiler_confirmed: false,
            service_config_id: None,
            service_revision: None,
            provider_id: None,
            model_id: None,
        },
    )
    .unwrap();
    assert_eq!(
        executor::start_or_resume(&store, &task.id).unwrap().status,
        "awaiting_external_result"
    );
    fs::write(
        Path::new(&task.materials_directory).join("result.json"),
        serde_json::to_vec_pretty(&summary_result()).unwrap(),
    )
    .unwrap();
    if cancel_before_import {
        SummaryTaskRepository::new(&store).finish_cancelled(&task.id).unwrap();
        assert!(executor::start_or_resume(&store, &task.id).is_err());
        assert!(SummaryResultRepository::new(&store).list_summaries(&task.project_id).unwrap().is_empty());
        return;
    }
    let error = executor::start_or_resume(&store, &task.id).unwrap_err();
    assert!(error.to_string().contains("未提供的画面"));
    assert!(SummaryResultRepository::new(&store).list_summaries(&task.project_id).unwrap().is_empty());
    let mut corrected = summary_result();
    for sections in [&mut corrected.speaker_narrative, &mut corrected.timeline,
        &mut corrected.core_concepts, &mut corrected.principles_or_architecture,
        &mut corrected.examples_and_scenarios, &mut corrected.design_tradeoffs, &mut corrected.conclusions] {
        for section in sections { for evidence in &mut section.evidence { evidence.frame_timestamps_ms.clear(); } }
    }
    fs::write(Path::new(&task.materials_directory).join("result.json"), serde_json::to_vec(&corrected).unwrap()).unwrap();
    let completed = executor::start_or_resume(&store, &task.id).unwrap();
    assert_eq!(completed.status, "completed");
    assert!(completed.output_summary_id.is_some());
}

fn seed_subtitle(store: &ProjectStore, project_id: &str) {
    let connection = store.connect().unwrap();
    connection.execute(
        "INSERT INTO subtitle_tracks (id, project_id, role, language_code, created_at_ms, updated_at_ms)
         VALUES ('track', ?1, 'original', 'en', 1, 1)",
        params![project_id],
    ).unwrap();
    connection.execute(
        "INSERT INTO subtitle_versions (id, track_id, project_id, version_number, status,
            source_kind, source_label, source_sha256, media_sha256, language_code,
            project_revision, preflight_json, created_at_ms)
         VALUES ('version', 'track', ?1, 1, 'ready', 'imported_file', 'fixture', ?2, ?2,
            'en', 1, ?3, 1)",
        params![project_id, "0".repeat(64), r#"{"status":"ready","segmentCount":1,"errorCount":0,"warningCount":0,"firstStartMs":0,"lastEndMs":1000,"mediaDurationMs":null,"coverageRatio":null,"issues":[]}"#],
    ).unwrap();
    connection
        .execute(
            "UPDATE subtitle_tracks SET current_version_id = 'version' WHERE id = 'track'",
            [],
        )
        .unwrap();
    connection.execute(
        "INSERT INTO subtitle_segments (id, version_id, lineage_id, ordinal, start_ms, end_ms, text)
         VALUES ('segment-1', 'version', 'segment-1', 0, 0, 1000, 'A component sends data to another component.')",
        [],
    ).unwrap();
}

fn summary_result() -> SummaryResult {
    let evidence = SummaryEvidence {
        kind: EvidenceKind::VideoStatement,
        claim: "组件之间传递数据".to_owned(),
        subtitle_ids: vec!["segment-1".to_owned()],
        frame_timestamps_ms: vec![500],
        citations: vec![],
    };
    let section = SummarySection {
        title: "数据流".to_owned(),
        body: "输入经过组件处理后传给下游，并在边界处完成格式检查、错误处理和结果验证。".repeat(2),
        evidence: vec![evidence],
    };
    SummaryResult {
        format_version: 2,
        title: "软件架构分析".to_owned(),
        overview: "讲者先解释组件边界，然后说明数据如何在组件间传递，最后讨论验证方式与适用限制。结构化报告 api_key=abcdefghijklmnop".repeat(2),
        covered_chunk_ordinals: vec![1],
        speaker_narrative: vec![section.clone()],
        timeline: vec![section.clone()],
        core_concepts: vec![section.clone()],
        principles_or_architecture: vec![section.clone()],
        examples_and_scenarios: vec![section.clone()],
        design_tradeoffs: vec![section.clone()],
        conclusions: vec![section],
        limitations: vec!["需要外部验证性能结论".to_owned()],
        glossary: vec![SummaryGlossaryEntry {
            term: "组件".to_owned(),
            explanation: "具有独立职责的模块".to_owned(),
            subtitle_ids: vec!["segment-1".to_owned()],
            citations: vec![],
        }],
        mermaid: Some("flowchart LR\nA --> B".to_owned()),
    }
}

#[test]
fn interrupted_export_directory_does_not_block_a_new_verified_report() {
    let (directory, store, task) = super::test_support::prepared_summary();
    // No frame timestamp is within this isolated zero-cutoff report.
    store.connect().unwrap().execute(
        "UPDATE summary_tasks SET playback_cutoff_ms=0 WHERE id=?1", [&task.id],
    ).unwrap();
    SummaryTaskRepository::new(&store).set_task_state(&task.id, "validating", "validating", 0.9).unwrap();
    let summary = SummaryResultRepository::new(&store).save_summary(&task.id, &summary_result(), false).unwrap();
    let output = directory.path().join("reports");
    fs::create_dir(&output).unwrap();
    let abandoned = output.join(format!(".siaovplay-summary-{}.tmp", summary.id));
    fs::create_dir(&abandoned).unwrap();
    fs::write(abandoned.join("report.md"), b"interrupted export retained").unwrap();
    let run = || report::export(&store, ExportVideoSummaryInput {
        summary_id: summary.id.clone(), directory: output.to_string_lossy().into_owned(),
    }).unwrap();
    let first = run();
    let first_bytes = fs::read(&first.report_path).unwrap();
    let second = run();
    assert_ne!(first.directory, second.directory);
    assert_eq!(fs::read(&first.report_path).unwrap(), first_bytes);
    assert_eq!(fs::read(abandoned.join("report.md")).unwrap(), b"interrupted export retained");
    for exported in [first, second] {
        assert_eq!(exported.asset_count, 0);
        let bytes = fs::read(&exported.report_path).unwrap();
        assert_eq!(format!("{:x}", Sha256::digest(&bytes)), exported.report_sha256);
        let manifest: Value = serde_json::from_slice(&fs::read(&exported.manifest_path).unwrap()).unwrap();
        assert_eq!(manifest["reportSha256"], exported.report_sha256);
    }
    assert_eq!(fs::read_dir(output).unwrap().count(), 3);
}
