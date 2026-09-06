use std::fs;

use rusqlite::params;

use super::*;
use crate::domain::CreateLocalProjectInput;

const MEDIA_SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

struct Fixture {
    _temporary: tempfile::TempDir,
    store: ProjectStore,
    project_id: String,
    source_version_id: String,
    translation_version_id: String,
    destination: PathBuf,
}

#[test]
fn export_does_not_decode_unselected_versions() {
    let fixture = fixture();
    fixture
        .store
        .connect()
        .unwrap()
        .execute(
            "UPDATE subtitle_versions SET preflight_json = 'invalid' WHERE id = ?1",
            params![fixture.translation_version_id],
        )
        .unwrap();
    let mut selected = input(
        &fixture,
        SubtitleExportMode::Original,
        SubtitleExportFormat::Srt,
    );
    selected.translation_version_id = None;
    assert_eq!(
        export_subtitles(&fixture.store, selected.clone())
            .unwrap()
            .cue_count,
        2
    );
    selected.mode = SubtitleExportMode::Translation;
    selected.source_version_id = None;
    selected.translation_version_id = Some(fixture.translation_version_id);
    assert!(export_subtitles(&fixture.store, selected).is_err());
}

#[test]
fn exports_original_translation_and_bilingual_subtitles_with_manifests() {
    let fixture = fixture();

    let original = export_subtitles(
        &fixture.store,
        input(
            &fixture,
            SubtitleExportMode::Original,
            SubtitleExportFormat::Srt,
        ),
    )
    .expect("original subtitles should export");
    assert_eq!(original.cue_count, 2);
    assert_eq!(
        original.source_version_id.as_deref(),
        Some(fixture.source_version_id.as_str())
    );
    let original_text = fs::read_to_string(&original.file_path).expect("SRT should be readable");
    assert!(original_text.contains("00:00:00,000 --> 00:00:01,500"));
    assert!(original_text.contains("Meet me at the station."));
    assert_manifest_matches(&original);

    let mut translation_input = input(
        &fixture,
        SubtitleExportMode::Translation,
        SubtitleExportFormat::Vtt,
    );
    translation_input.source_version_id = None;
    let translation =
        export_subtitles(&fixture.store, translation_input).expect("translation should export");
    let translation_text =
        fs::read_to_string(&translation.file_path).expect("VTT should be readable");
    assert!(translation_text.starts_with("WEBVTT\n\n"));
    assert!(translation_text.contains("00:00:00.000 --> 00:00:01.500"));
    assert!(translation_text.contains("在车站等我。"));
    assert_manifest_matches(&translation);

    let bilingual = export_subtitles(
        &fixture.store,
        input(
            &fixture,
            SubtitleExportMode::Bilingual,
            SubtitleExportFormat::Srt,
        ),
    )
    .expect("bilingual subtitles should export");
    let bilingual_text =
        fs::read_to_string(&bilingual.file_path).expect("bilingual SRT should read");
    assert!(bilingual_text.contains("Meet me at the station.\n在车站等我。"));
    assert!(bilingual_text.contains("Bring the blue umbrella.\n带上蓝色雨伞。"));
    assert_manifest_matches(&bilingual);
}

#[test]
fn refuses_unconfirmed_or_mismatched_bilingual_versions() {
    let fixture = fixture();
    let mut unconfirmed = input(
        &fixture,
        SubtitleExportMode::Original,
        SubtitleExportFormat::Srt,
    );
    unconfirmed.confirm_version_selection = false;
    assert!(matches!(
        export_subtitles(&fixture.store, unconfirmed),
        Err(DeliveryError::InvalidExport(_))
    ));

    fixture
        .store
        .connect()
        .expect("connection should open")
        .execute(
            "UPDATE subtitle_segments
             SET source_segment_id = (
                 SELECT id FROM subtitle_segments
                 WHERE version_id = ?1 AND ordinal = 0
             )
             WHERE version_id = ?1 AND ordinal = 1",
            params![fixture.translation_version_id],
        )
        .expect("translation relation should change");
    let error = export_subtitles(
        &fixture.store,
        input(
            &fixture,
            SubtitleExportMode::Bilingual,
            SubtitleExportFormat::Vtt,
        ),
    )
    .expect_err("mismatched versions should be rejected");
    assert!(matches!(error, DeliveryError::InvalidExport(_)));
    assert!(error.to_string().contains("不匹配"));
}

fn fixture() -> Fixture {
    let temporary = tempfile::tempdir().expect("temporary directory should work");
    let media_path = temporary.path().join("fixture.mp4");
    fs::write(&media_path, b"test-media").expect("media fixture should write");
    let store = ProjectStore::open(
        temporary
            .path()
            .join("data")
            .join("projects")
            .join("siaovplay.db"),
    )
    .expect("store should open");
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: path_to_string(&media_path),
            title: Some("Rain: Platform".to_owned()),
        })
        .expect("project should create");
    store
        .record_media_probe(
            &project.id,
            &project.media_source.id,
            MEDIA_SHA,
            "{}",
            10,
            None,
        )
        .expect("media hash should persist");

    let source_track_id = Uuid::new_v4().to_string();
    let source_version_id = Uuid::new_v4().to_string();
    let translation_track_id = Uuid::new_v4().to_string();
    let translation_version_id = Uuid::new_v4().to_string();
    let source_segment_ids = [Uuid::new_v4().to_string(), Uuid::new_v4().to_string()];
    let preflight = r#"{"status":"ready","segmentCount":2,"errorCount":0,"warningCount":0,"firstStartMs":0,"lastEndMs":3000,"mediaDurationMs":3000,"coverageRatio":1.0,"issues":[]}"#;
    let mut connection = store.connect().expect("connection should open");
    let transaction = connection.transaction().expect("transaction should start");
    transaction
        .execute(
            "INSERT INTO subtitle_tracks (
                id, project_id, role, language_code, current_version_id,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'original', 'en', ?3, 1, 1)",
            params![source_track_id, project.id, source_version_id],
        )
        .expect("source track should insert");
    insert_version(
        &transaction,
        &source_version_id,
        &source_track_id,
        &project.id,
        "ready",
        "imported_file",
        "fixture-en.srt",
        "en",
        preflight,
    );
    transaction
        .execute(
            "INSERT INTO subtitle_tracks (
                id, project_id, role, language_code, current_version_id,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'translation', 'zh-cn', ?3, 1, 1)",
            params![translation_track_id, project.id, translation_version_id],
        )
        .expect("translation track should insert");
    insert_version(
        &transaction,
        &translation_version_id,
        &translation_track_id,
        &project.id,
        "draft",
        "agent_translation",
        "Codex",
        "zh-cn",
        preflight,
    );
    insert_segment(
        &transaction,
        &source_segment_ids[0],
        &source_version_id,
        None,
        0,
        0,
        1_500,
        "Meet me at the station.",
    );
    insert_segment(
        &transaction,
        &source_segment_ids[1],
        &source_version_id,
        None,
        1,
        1_500,
        3_000,
        "Bring the blue umbrella.",
    );
    insert_segment(
        &transaction,
        &Uuid::new_v4().to_string(),
        &translation_version_id,
        Some(&source_segment_ids[0]),
        0,
        0,
        1_500,
        "在车站等我。",
    );
    insert_segment(
        &transaction,
        &Uuid::new_v4().to_string(),
        &translation_version_id,
        Some(&source_segment_ids[1]),
        1,
        1_500,
        3_000,
        "带上蓝色雨伞。",
    );
    transaction.commit().expect("fixture should commit");
    let destination = temporary.path().join("exports");
    fs::create_dir_all(&destination).expect("destination should create");
    Fixture {
        _temporary: temporary,
        store,
        project_id: project.id,
        source_version_id,
        translation_version_id,
        destination,
    }
}

#[allow(clippy::too_many_arguments)]
fn insert_version(
    transaction: &rusqlite::Transaction<'_>,
    version_id: &str,
    track_id: &str,
    project_id: &str,
    status: &str,
    source_kind: &str,
    source_label: &str,
    language_code: &str,
    preflight: &str,
) {
    transaction
        .execute(
            "INSERT INTO subtitle_versions (
                id, track_id, project_id, version_number, status,
                source_kind, source_label, source_sha256, media_sha256,
                language_code, project_revision, preflight_json, created_at_ms
             ) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, 1)",
            params![
                version_id,
                track_id,
                project_id,
                status,
                source_kind,
                source_label,
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                MEDIA_SHA,
                language_code,
                preflight
            ],
        )
        .expect("subtitle version should insert");
}

#[allow(clippy::too_many_arguments)]
fn insert_segment(
    transaction: &rusqlite::Transaction<'_>,
    id: &str,
    version_id: &str,
    source_segment_id: Option<&str>,
    ordinal: i64,
    start_ms: i64,
    end_ms: i64,
    text: &str,
) {
    transaction
        .execute(
            "INSERT INTO subtitle_segments (
                id, version_id, lineage_id, source_segment_id, ordinal,
                start_ms, end_ms, text, confidence, issue_kind
             ) VALUES (?1, ?2, ?1, ?3, ?4, ?5, ?6, ?7, NULL, NULL)",
            params![
                id,
                version_id,
                source_segment_id,
                ordinal,
                start_ms,
                end_ms,
                text
            ],
        )
        .expect("subtitle segment should insert");
}

fn input(
    fixture: &Fixture,
    mode: SubtitleExportMode,
    format: SubtitleExportFormat,
) -> ExportSubtitlesInput {
    ExportSubtitlesInput {
        project_id: fixture.project_id.clone(),
        mode,
        format,
        source_version_id: Some(fixture.source_version_id.clone()),
        translation_version_id: Some(fixture.translation_version_id.clone()),
        destination_directory: path_to_string(&fixture.destination),
        confirm_version_selection: true,
    }
}

fn assert_manifest_matches(exported: &SubtitleExport) {
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&exported.manifest_path).expect("manifest should read"))
            .expect("manifest should parse");
    assert_eq!(manifest["format"], EXPORT_MANIFEST_FORMAT);
    assert_eq!(manifest["subtitleFileSha256"], exported.file_sha256);
    assert_eq!(
        hash_file(Path::new(&exported.file_path)).expect("file should hash"),
        exported.file_sha256
    );
}
