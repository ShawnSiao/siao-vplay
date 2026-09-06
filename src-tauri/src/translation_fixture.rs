use super::*;
use crate::domain::CreateLocalProjectInput;
use tempfile::TempDir;

pub(crate) struct TranslationFixture {
    _temporary: TempDir,
    pub(crate) store: ProjectStore,
    pub(crate) project_id: String,
    pub(crate) source_version_id: String,
    pub(crate) segment_ids: Vec<String>,
    pub(crate) media_path: PathBuf,
}

impl TranslationFixture {
    pub(crate) fn new() -> Self {
        let temporary = tempfile::tempdir().expect("temporary directory should be created");
        let media_path = temporary.path().join("source-video.mp4");
        fs::write(&media_path, b"authorized-media-fixture")
            .expect("media fixture should be written");
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
                media_path: media_path.to_string_lossy().into_owned(),
                title: Some("translation fixture".to_owned()),
            })
            .expect("project should be created");
        let track_id = Uuid::new_v4().to_string();
        let source_version_id = Uuid::new_v4().to_string();
        let segment_ids = vec![Uuid::new_v4().to_string(), Uuid::new_v4().to_string()];
        let media_sha256 = "a".repeat(64);
        let source_sha256 = "b".repeat(64);
        let cues = vec![
            SubtitleCue {
                ordinal: 1,
                start_ms: 0,
                end_ms: 1_200,
                text: "また明日、駅前で。".to_owned(),
                confidence: None,
            },
            SubtitleCue {
                ordinal: 2,
                start_ms: 1_400,
                end_ms: 2_600,
                text: "約束だからな。".to_owned(),
                confidence: None,
            },
        ];
        let preflight = subtitles::inspect_cues(&cues, Some(3_000));
        let timestamp = now_ms().expect("timestamp should work");
        let mut connection = store.connect().expect("database should open");
        let transaction = connection.transaction().expect("transaction should start");
        transaction
            .execute(
                "UPDATE media_sources
                 SET source_sha256 = ?2, probed_at_ms = ?3
                 WHERE id = ?1",
                params![project.media_source.id, media_sha256, timestamp],
            )
            .expect("media fingerprint should be set");
        transaction
            .execute(
                "UPDATE projects
                 SET revision = 2, updated_at_ms = ?2
                 WHERE id = ?1",
                params![project.id, timestamp],
            )
            .expect("project revision should update");
        transaction
            .execute(
                "INSERT INTO subtitle_tracks (
                    id, project_id, role, language_code, current_version_id,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'original', 'ja', NULL, ?3, ?3)",
                params![track_id, project.id, timestamp],
            )
            .expect("original track should be inserted");
        transaction
            .execute(
                "INSERT INTO subtitle_versions (
                    id, track_id, project_id, version_number, status,
                    source_kind, source_label, source_sha256, media_sha256,
                    language_code, project_revision, preflight_json,
                    created_at_ms
                 ) VALUES (
                    ?1, ?2, ?3, 1, 'ready',
                    'imported_file', 'fixture.vtt', ?4, ?5,
                    'ja', 2, ?6, ?7
                 )",
                params![
                    source_version_id,
                    track_id,
                    project.id,
                    source_sha256,
                    media_sha256,
                    serde_json::to_string(&preflight).expect("preflight should serialize"),
                    timestamp,
                ],
            )
            .expect("source version should be inserted");
        for (index, cue) in cues.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO subtitle_segments (
                        id, version_id, ordinal, start_ms, end_ms, text, confidence
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
                    params![
                        segment_ids[index],
                        source_version_id,
                        i64::try_from(cue.ordinal).expect("ordinal should fit"),
                        cue.start_ms,
                        cue.end_ms,
                        cue.text,
                    ],
                )
                .expect("source segment should be inserted");
        }
        transaction
            .execute(
                "UPDATE subtitle_tracks
                 SET current_version_id = ?2
                 WHERE id = ?1",
                params![track_id, source_version_id],
            )
            .expect("source version should become current");
        transaction.commit().expect("fixture should commit");
        Self {
            _temporary: temporary,
            store,
            project_id: project.id,
            source_version_id,
            segment_ids,
            media_path,
        }
    }

    pub(crate) fn prepare_manual(&self) -> TranslationTask {
        self.prepare_manual_for("en", "zh-cn")
    }

    pub(crate) fn prepare_manual_for(
        &self,
        source_language_code: &str,
        target_language_code: &str,
    ) -> TranslationTask {
        prepare_translation_task(
            &self.store,
            PrepareTranslationTaskInput {
                target_language_code: target_language_code.to_owned(),
                ..crate::translation_test_support::translation_input(
                    self.project_id.clone(),
                    "manual",
                    source_language_code,
                )
            },
        )
        .expect("manual task should be prepared")
    }

    pub(crate) fn result_value(&self, task: &TranslationTask) -> Value {
        json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "protocolVersion": PROTOCOL_VERSION,
            "taskId": task.id,
            "sourceVersionId": self.source_version_id,
            "targetLanguageCode": task.target_language_code,
            "translations": [
                {
                    "segmentId": self.segment_ids[0],
                    "translatedText": "明天还在车站前见。"
                },
                {
                    "segmentId": self.segment_ids[1],
                    "translatedText": "说好了啊。"
                }
            ]
        })
    }

    pub(crate) fn write_result(&self, name: &str, value: &Value) -> PathBuf {
        let path = self
            .store
            .data_directory()
            .parent()
            .expect("data directory should have a parent")
            .join(name);
        fs::write(
            &path,
            serde_json::to_vec_pretty(value).expect("result should serialize"),
        )
        .expect("result fixture should be written");
        path
    }
}
