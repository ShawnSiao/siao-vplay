use super::{
    materials::prepare,
    model::{
        AnalysisMode, AnalysisScope, PrepareSummaryTaskInput, PromptSelection,
        SummaryExecutionKind, SummaryTask,
    },
};
use crate::{domain::CreateLocalProjectInput, store::ProjectStore};
use rusqlite::params;
use std::fs;

pub(crate) fn prepared_summary() -> (tempfile::TempDir, ProjectStore, SummaryTask) {
    prepared_summary_with_history(false)
}

pub(crate) fn prepared_summary_with_history(corrupt_history: bool) -> (tempfile::TempDir, ProjectStore, SummaryTask) {
    let directory = tempfile::tempdir().unwrap();
    let media_path = directory.path().join("fixture.mp4");
    fs::write(&media_path, b"fixture").unwrap();
    let store = ProjectStore::open(directory.path().join("data/projects/siaovplay.db")).unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: media_path.to_string_lossy().into_owned(),
            title: Some("测试视频".to_owned()),
        })
        .unwrap();
    let connection = store.connect().unwrap();
    connection.execute(
            "INSERT INTO subtitle_tracks (id, project_id, role, language_code, created_at_ms, updated_at_ms)
             VALUES ('track', ?1, 'original', 'en', 1, 1)", params![project.id],
        ).unwrap();
    connection.execute(
            "INSERT INTO subtitle_versions (id, track_id, project_id, version_number, status,
                source_kind, source_label, source_sha256, media_sha256, language_code,
                project_revision, preflight_json, created_at_ms)
             VALUES ('version', 'track', ?1, 1, 'ready', 'imported_file', 'fixture', ?2, ?2,
                'en', 1, ?3, 1)",
            params![project.id, "0".repeat(64), r#"{"status":"ready","segmentCount":2,"errorCount":0,"warningCount":0,"firstStartMs":0,"lastEndMs":2100,"mediaDurationMs":null,"coverageRatio":null,"issues":[]}"#],
        ).unwrap();
    connection
        .execute(
            "UPDATE subtitle_tracks SET current_version_id = 'version' WHERE id = 'track'",
            [],
        )
        .unwrap();
    for (id, ordinal, start) in [("past", 0, 0), ("future", 1, 2_000)] {
        connection.execute(
                "INSERT INTO subtitle_segments (id, version_id, lineage_id, ordinal, start_ms, end_ms, text)
                 VALUES (?1, 'version', ?1, ?2, ?3, ?4, ?1)",
                params![id, ordinal, start, start + 100],
            ).unwrap();
    }
    if corrupt_history {
        connection.execute(
            "INSERT INTO subtitle_versions (id, track_id, project_id, version_number, status,
                source_kind, source_label, source_sha256, media_sha256, language_code,
                project_revision, preflight_json, created_at_ms)
             SELECT 'unselected-history', track_id, project_id, 2, status, source_kind,
                source_label, source_sha256, media_sha256, language_code, project_revision,
                'invalid', created_at_ms FROM subtitle_versions WHERE id = 'version'", [],
        ).unwrap();
    }
    drop(connection);
    let task = prepare(
        &store,
        PrepareSummaryTaskInput {
            project_id: project.id,
            scope: AnalysisScope::CurrentProgress,
            playback_cutoff_ms: Some(1_000),
            analysis_mode: AnalysisMode::Automatic,
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
    (directory, store, task)
}
