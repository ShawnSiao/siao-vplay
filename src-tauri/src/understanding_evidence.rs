use crate::{commands::CommandError, store::ProjectStore, understanding::UnderstandingError};
use crate::{
    understanding,
    verified_task_files::{self, TaskDomain},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ExplanationEvidence {
    pub explanation_id: String,
    pub project_id: String,
    pub task_id: String,
    pub source_version_id: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub playback_cutoff_ms: i64,
    #[cfg_attr(test, schemars(length(max = 40)))]
    pub subtitles: Vec<SubtitleEvidence>,
    #[cfg_attr(test, schemars(length(max = 6)))]
    pub frames: Vec<FrameEvidence>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct SubtitleEvidence {
    pub segment_id: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub start_ms: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub end_ms: i64,
    #[cfg_attr(test, schemars(length(max = 20000)))]
    pub text: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct FrameEvidence {
    pub id: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub timestamp_ms: i64,
}

#[tauri::command]
pub async fn get_explanation_evidence(
    store: tauri::State<'_, ProjectStore>,
    explanation_id: String,
) -> Result<ExplanationEvidence, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        resolve(&store, &explanation_id).map_err(Into::into)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceLine {
    segment_id: String,
    start_ms: i64,
    end_ms: i64,
    source_text: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Context {
    playback_cutoff_ms: i64,
    frames: Vec<ContextFrame>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextFrame {
    id: String,
    timestamp_ms: i64,
}

fn invalid() -> UnderstandingError {
    UnderstandingError::TaskIntegrity("证据与原任务材料不一致".to_owned())
}

fn resolve(store: &ProjectStore, id: &str) -> Result<ExplanationEvidence, UnderstandingError> {
    let explanation = understanding::get_explanation(store, id)?;
    let task = understanding::get_explanation_task(store, &explanation.task_id)?;
    if explanation.project_id != task.project_id
        || explanation.source_version_id != task.source_version_id
        || explanation.playback_cutoff_ms != task.playback_cutoff_ms
        || task.output_explanation_id.as_deref() != Some(id)
    {
        return Err(invalid());
    }
    let mut subtitle_ids = BTreeSet::new();
    let mut frame_ids = BTreeSet::new();
    for entry in explanation
        .confirmed_facts
        .iter()
        .chain(&explanation.possible_interpretations)
    {
        subtitle_ids.extend(entry.subtitle_segment_ids.iter().cloned());
        frame_ids.extend(entry.frame_ids.iter().cloned());
    }
    if subtitle_ids.len() > 40
        || frame_ids.len() > 6
        || subtitle_ids
            .iter()
            .any(|id| !task.authorized_segment_ids.contains(id))
    {
        return Err(invalid());
    }
    // Read exactly the bytes checked against the original task's stored manifest.
    // Never substitute the project's current subtitle version or expose file paths.
    let mut subtitles = Vec::new();
    if !subtitle_ids.is_empty() {
        let source: Vec<SourceLine> = serde_json::from_slice(&verified_task_files::read_for_task(
            store,
            TaskDomain::Explanation,
            &task.id,
            "input/subtitles.json",
        )?)?;
        for line in source
            .into_iter()
            .filter(|line| subtitle_ids.contains(&line.segment_id))
        {
            if line.start_ms < 0
                || line.start_ms > task.playback_cutoff_ms
                || line.end_ms < line.start_ms
                || line.source_text.chars().count() > 20_000
            {
                return Err(invalid());
            }
            subtitles.push(SubtitleEvidence {
                segment_id: line.segment_id,
                start_ms: line.start_ms,
                end_ms: line.end_ms,
                text: line.source_text,
            });
        }
        if subtitles.len() != subtitle_ids.len()
            || subtitles
                .iter()
                .map(|line| &line.segment_id)
                .collect::<BTreeSet<_>>()
                .len()
                != subtitles.len()
        {
            return Err(invalid());
        }
    }
    let mut frames = Vec::new();
    if !frame_ids.is_empty() {
        let context: Context = serde_json::from_slice(&verified_task_files::read_for_task(
            store,
            TaskDomain::Explanation,
            &task.id,
            "input/context.json",
        )?)?;
        if context.playback_cutoff_ms != task.playback_cutoff_ms {
            return Err(invalid());
        }
        for frame in context
            .frames
            .into_iter()
            .filter(|frame| frame_ids.contains(&frame.id))
        {
            if frame.timestamp_ms < 0
                || frame.timestamp_ms > task.playback_cutoff_ms
                || !task.frames.iter().any(|stored| {
                    stored.id == frame.id && stored.timestamp_ms == frame.timestamp_ms
                })
            {
                return Err(invalid());
            }
            frames.push(FrameEvidence {
                id: frame.id,
                timestamp_ms: frame.timestamp_ms,
            });
        }
        if frames.len() != frame_ids.len()
            || frames
                .iter()
                .map(|frame| &frame.id)
                .collect::<BTreeSet<_>>()
                .len()
                != frames.len()
        {
            return Err(invalid());
        }
    }
    Ok(ExplanationEvidence {
        explanation_id: explanation.id,
        project_id: explanation.project_id,
        task_id: task.id,
        source_version_id: task.source_version_id,
        playback_cutoff_ms: task.playback_cutoff_ms,
        subtitles,
        frames,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::understanding::{self, ImportExplanationResultInput, test_fixture::Fixture};
    fn completed(fixture: &Fixture) -> understanding::ExplanationApplication {
        let task = fixture.prepare();
        let result = fixture.result_path(&task, task.playback_cutoff_ms);
        understanding::import_explanation_result(
            &fixture.store,
            ImportExplanationResultInput {
                task_id: task.id,
                result_path: result.to_string_lossy().into_owned(),
            },
        )
        .unwrap()
    }
    #[test]
    fn resolves_only_referenced_original_material_and_frame_times() {
        let fixture = Fixture::new();
        let result = completed(&fixture);
        fixture
            .store
            .connect()
            .unwrap()
            .execute(
                "UPDATE subtitle_segments SET text = 'later edited text'",
                [],
            )
            .unwrap();
        let evidence = resolve(&fixture.store, &result.explanation.id).unwrap();
        assert_eq!(evidence.subtitles.len(), 1);
        assert_eq!(evidence.subtitles[0].text, "最初の台詞");
        assert_eq!(evidence.subtitles[0].start_ms, 0);
        assert_eq!(evidence.frames.len(), 1);
        assert_eq!(
            evidence.frames[0].timestamp_ms,
            result.task.frames[0].timestamp_ms
        );
        assert_eq!(evidence.source_version_id, result.task.source_version_id);
        assert!(!serde_json::to_string(&evidence).unwrap().contains("path"));
    }
    #[test]
    fn tampered_material_does_not_replace_the_saved_result() {
        let fixture = Fixture::new();
        let result = completed(&fixture);
        let file = fixture
            .store
            .data_directory()
            .join("agent-tasks")
            .join(&result.task.id)
            .join("input/subtitles.json");
        std::fs::write(file, "[]").unwrap();
        assert!(resolve(&fixture.store, &result.explanation.id).is_err());
        assert_eq!(
            understanding::get_explanation(&fixture.store, &result.explanation.id).unwrap(),
            result.explanation
        );
    }
    #[test]
    fn refuses_unknown_references_and_changed_frame_timestamps() {
        let fixture = Fixture::new();
        let result = completed(&fixture);
        let connection = fixture.store.connect().unwrap();
        connection
            .execute(
                "UPDATE explanation_frames SET timestamp_ms = timestamp_ms + 1 WHERE task_id = ?1",
                [&result.task.id],
            )
            .unwrap();
        assert!(resolve(&fixture.store, &result.explanation.id).is_err());
        connection
            .execute(
                "UPDATE explanation_frames SET timestamp_ms = timestamp_ms - 1 WHERE task_id = ?1",
                [&result.task.id],
            )
            .unwrap();
        let changed = serde_json::json!([{ "text": "fact", "subtitleSegmentIds": ["unrelated-subtitle"], "frameIds": [] }]);
        connection
            .execute(
                "UPDATE explanations SET confirmed_facts_json = ?1 WHERE id = ?2",
                rusqlite::params![changed.to_string(), result.explanation.id],
            )
            .unwrap();
        assert!(resolve(&fixture.store, &result.explanation.id).is_err());
    }
}
