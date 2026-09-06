use super::*;
use crate::{
    domain::CreateLocalProjectInput,
    media::{AudioStream, SubtitleStream, VideoStream},
    subtitles::{
        GeneratedSubtitleCue, PersistTranscriptionInput, SubtitleCue, persist_transcription,
    },
};
use tempfile::TempDir;

pub(crate) struct Fixture {
    _temporary: TempDir,
    pub(crate) store: ProjectStore,
    pub(crate) project_id: String,
    pub(crate) media_path: PathBuf,
}

impl Fixture {
    pub(crate) fn new() -> Self {
        let temporary = tempfile::tempdir().expect("temporary directory should work");
        let media_path = temporary.path().join("scene.mp4");
        fs::write(&media_path, b"authorized-scene-media").expect("media fixture should be written");
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
                title: Some("understanding fixture".to_owned()),
            })
            .expect("project should be created");
        let metadata = fs::metadata(&media_path).expect("metadata should read");
        let modified = modified_at_ms(&metadata).expect("modified time should read");
        let probe = MediaProbe {
            container_formats: vec!["mp4".to_owned()],
            duration_ms: Some(10_000),
            size_bytes: Some(metadata.len()),
            bit_rate: None,
            video_streams: vec![VideoStream {
                index: 0,
                codec_name: "h264".to_owned(),
                profile: None,
                pixel_format: Some("yuv420p".to_owned()),
                width: 320,
                height: 180,
                frame_rate: Some(25.0),
                duration_ms: Some(10_000),
            }],
            audio_streams: Vec::<AudioStream>::new(),
            subtitle_streams: Vec::<SubtitleStream>::new(),
        };
        store
            .record_media_probe(
                &project.id,
                &project.media_source.id,
                &"a".repeat(64),
                &serde_json::to_string(&probe).expect("probe should serialize"),
                metadata.len(),
                modified,
            )
            .expect("media baseline should persist");
        let cues = [
            (0, 0, 1_000, "最初の台詞"),
            (1, 2_000, 3_000, "今ここで待っている"),
            (2, 4_000, 5_000, "雨が降り始めた"),
            (3, 6_000, 7_000, "これは未来の台詞"),
        ]
        .into_iter()
        .map(|(ordinal, start_ms, end_ms, text)| GeneratedSubtitleCue {
            cue: SubtitleCue {
                ordinal,
                start_ms,
                end_ms,
                text: text.to_owned(),
                confidence: None,
            },
            words: Vec::new(),
        })
        .collect();
        persist_transcription(
            &store,
            PersistTranscriptionInput {
                project_id: project.id.clone(),
                source_label: "real transcription".to_owned(),
                source_sha256: "b".repeat(64),
                language_code: "ja".to_owned(),
                expected_project_revision: project.revision,
                expected_media_sha256: "a".repeat(64),
                media_duration_ms: Some(10_000),
                cues,
            },
        )
        .expect("source subtitle should persist");
        Self {
            _temporary: temporary,
            store,
            project_id: project.id,
            media_path,
        }
    }

    pub(crate) fn prepare(&self) -> ExplanationTask {
        self.prepare_with_prompt(PromptSelection::default())
    }

    pub(crate) fn prepare_with_prompt(&self, prompt_selection: PromptSelection) -> ExplanationTask {
        self.prepare_with_options(prompt_selection, true)
    }

    pub(crate) fn prepare_with_options(
        &self,
        prompt_selection: PromptSelection,
        include_frames: bool,
    ) -> ExplanationTask {
        prepare_explanation_task_with(
            &self.store,
            PrepareExplanationTaskInput {
                project_id: self.project_id.clone(),
                handoff_kind: "manual".to_owned(),
                playback_cutoff_ms: 4_500,
                include_frames,
                prompt_selection,
            },
            |_media_path, timestamp_ms, output_path| {
                fs::write(output_path, format!("jpeg-at-{timestamp_ms}"))?;
                Ok(())
            },
        )
        .expect("explanation task should prepare")
    }

    pub(crate) fn result_path(&self, task: &ExplanationTask, cutoff_ms: i64) -> PathBuf {
        let path = self._temporary.path().join("result.json");
        fs::write(
            &path,
            serde_json::to_vec_pretty(&json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "protocolVersion": task.protocol_version,
                "taskId": task.id,
                "sourceVersionId": task.source_version_id,
                "playbackCutoffMs": cutoff_ms,
                "confirmedFacts": [{
                    "text": "人物明确说会在这里等待。",
                    "subtitleSegmentIds": [task.authorized_segment_ids[0]],
                    "frameIds": []
                }],
                "possibleInterpretations": [{
                    "text": "结合当前语气，人物可能在掩饰不安。",
                    "subtitleSegmentIds": [task.authorized_segment_ids[0]],
                    "frameIds": [task.frames[0].id]
                }],
                "withheldReason": "后续发展未展开，以避免剧透。"
            }))
            .expect("result should serialize"),
        )
        .expect("result should be written");
        path
    }
}
