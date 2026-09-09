use std::{collections::BTreeMap, fs, path::Path};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{
    chunker::{PlannedChunk, plan_chunks},
    keyframes,
    model::{AnalysisMode, AnalysisScope, PrepareSummaryTaskInput, SummaryTask},
    repository::PromptTemplateRepository,
    result_validation::result_schema,
    task_repository::{NewSummaryChunk, NewSummaryTask, SummaryTaskRepository},
};
use crate::{
    store::{ProjectStore, StoreError},
    subtitles::{SubtitleSegment, list_current_subtitle_versions},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MaterialManifest<'a> {
    protocol_version: &'static str,
    project_id: &'a str,
    scope: AnalysisScope,
    playback_cutoff_ms: Option<i64>,
    analysis_mode: AnalysisMode,
    subtitle_version_id: &'a str,
    subtitle_language: &'a str,
    prompt_sha256: &'a str,
    visual_material_authorized: bool,
    segment_count: usize,
    segments: &'a [SubtitleSegment],
    frame_timestamps_ms: Vec<i64>,
}

pub(crate) fn prepare(
    store: &ProjectStore,
    input: PrepareSummaryTaskInput,
) -> Result<SummaryTask, StoreError> {
    let _data_access = crate::storage::database_access::shared(store.database_path())?;
    validate_input(&input)?;
    let project = store.get_project(&input.project_id)?;
    let versions = list_current_subtitle_versions(store, &input.project_id)
        .map_err(|error| StoreError::Validation(error.to_string()))?;
    let version = versions
        .iter()
        .find(|version| version.is_current && version.role == "original")
        .or_else(|| versions.iter().find(|version| version.is_current))
        .ok_or_else(|| StoreError::Validation("请先准备当前字幕版本".to_owned()))?;
    let segments = authorized_segments(&version.segments, input.scope, input.playback_cutoff_ms);
    if segments.is_empty() {
        return Err(StoreError::Validation(
            "授权范围内没有可总结的字幕".to_owned(),
        ));
    }
    let prompt = PromptTemplateRepository::new(store).snapshot(
        &input.prompt_selection.template_id,
        &input.prompt_selection.one_time_requirements,
    )?;
    if prompt.task_type != super::model::AnalysisTaskType::Summary {
        return Err(StoreError::Validation(
            "请选择视频总结提示词模板".to_owned(),
        ));
    }
    let plans = plan_chunks(&segments);
    let planned_frames = if input.visual_material_authorized {
        keyframes::planned_timestamps(
            &plans,
            if input.scope == AnalysisScope::CurrentProgress {
                input.playback_cutoff_ms
            } else {
                None
            },
        )
    } else {
        Vec::new()
    };
    let manifest = MaterialManifest {
        protocol_version: "siaovplay-summary-v1",
        project_id: &project.id,
        scope: input.scope,
        playback_cutoff_ms: input.playback_cutoff_ms,
        analysis_mode: input.analysis_mode,
        subtitle_version_id: &version.id,
        subtitle_language: &version.language_code,
        prompt_sha256: &prompt.sha256,
        visual_material_authorized: input.visual_material_authorized,
        segment_count: segments.len(),
        segments: &segments,
        frame_timestamps_ms: planned_frames
            .iter()
            .map(|(_, timestamp)| *timestamp)
            .collect(),
    };
    let manifest_bytes =
        serde_json::to_vec(&manifest).map_err(|error| StoreError::Validation(error.to_string()))?;
    let manifest_sha = digest(&manifest_bytes);
    let chunk_materials = plans
        .iter()
        .map(|chunk| digest_chunk(chunk, &segments))
        .collect::<Result<Vec<_>, _>>()?;
    let chunks = plans
        .iter()
        .zip(&chunk_materials)
        .map(|(chunk, hash)| NewSummaryChunk {
            ordinal: chunk.ordinal,
            start_ms: chunk.start_ms,
            end_ms: chunk.end_ms,
            segment_ids: &chunk.segment_ids,
            context_segment_ids: &chunk.context_segment_ids,
            material_sha256: hash,
        })
        .collect::<Vec<_>>();
    let repository = SummaryTaskRepository::new(store);
    let task = repository.create(
        NewSummaryTask {
            project_id: &input.project_id,
            scope: input.scope,
            playback_cutoff_ms: input.playback_cutoff_ms,
            analysis_mode: input.analysis_mode,
            execution_kind: input.execution_kind,
            prompt_snapshot: &prompt,
            subtitle_version_id: &version.id,
            material_manifest_sha256: &manifest_sha,
            visual_material_authorized: input.visual_material_authorized,
            spoiler_confirmed: input.spoiler_confirmed,
            service_config_id: input.service_config_id.as_deref(),
            service_revision: input.service_revision,
            provider_id: input.provider_id.as_deref(),
            model_id: input.model_id.as_deref(),
        },
        &chunks,
    )?;
    if let Err(error) = write_materials(
        &repository.materials_directory(&task.id),
        &manifest_bytes,
        &prompt.composed_prompt,
        &segments,
        &plans,
    ) {
        let _ = repository.set_task_state(&task.id, "failed", "material_write_failed", 0.0);
        return Err(error);
    }
    if input.visual_material_authorized
        && let Err(error) = keyframes::extract(
            store,
            &task.id,
            &project.media_source.locator,
            &repository.materials_directory(&task.id),
            &planned_frames,
        )
    {
        let _ = repository.set_task_state(&task.id, "failed", "frame_extraction_failed", 0.0);
        return Err(error);
    }
    repository.get(&task.id)
}

pub(crate) fn open_materials(store: &ProjectStore, task_id: &str) -> Result<bool, StoreError> {
    let repository = SummaryTaskRepository::new(store);
    repository.get(task_id)?;
    let directory = dunce::canonicalize(repository.materials_directory(task_id))?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(&directory)
            .creation_flags(0x0800_0000)
            .spawn()?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = directory;
        Err(StoreError::Validation(
            "当前平台不支持打开总结材料目录".to_owned(),
        ))
    }
}

fn validate_input(input: &PrepareSummaryTaskInput) -> Result<(), StoreError> {
    if !input.subtitles_authorized {
        return Err(StoreError::Validation(
            "必须确认向所选执行方式发送任务范围内的字幕".to_owned(),
        ));
    }
    match input.scope {
        AnalysisScope::CurrentProgress
            if input.playback_cutoff_ms.is_none_or(|value| value < 0) =>
        {
            Err(StoreError::Validation(
                "截至当前进度必须提供有效截止点".to_owned(),
            ))
        }
        AnalysisScope::FullVideo if !input.spoiler_confirmed => Err(StoreError::Validation(
            "生成完整视频总结前必须确认剧透".to_owned(),
        )),
        _ => Ok(()),
    }
}

fn authorized_segments(
    segments: &[SubtitleSegment],
    scope: AnalysisScope,
    cutoff_ms: Option<i64>,
) -> Vec<SubtitleSegment> {
    segments
        .iter()
        .filter(|segment| {
            scope == AnalysisScope::FullVideo
                || cutoff_ms.is_some_and(|cutoff| segment.start_ms <= cutoff)
        })
        .cloned()
        .collect()
}

fn digest_chunk(chunk: &PlannedChunk, segments: &[SubtitleSegment]) -> Result<String, StoreError> {
    let by_id = segments
        .iter()
        .map(|segment| (&segment.id, segment))
        .collect::<BTreeMap<_, _>>();
    let material = chunk
        .context_segment_ids
        .iter()
        .chain(&chunk.segment_ids)
        .filter_map(|id| by_id.get(id))
        .copied()
        .collect::<Vec<_>>();
    serde_json::to_vec(&material)
        .map(|bytes| digest(&bytes))
        .map_err(|error| StoreError::Validation(error.to_string()))
}

fn write_materials(
    directory: &Path,
    manifest: &[u8],
    prompt: &str,
    segments: &[SubtitleSegment],
    chunks: &[PlannedChunk],
) -> Result<(), StoreError> {
    fs::create_dir_all(directory)?;
    fs::write(directory.join("manifest.json"), manifest)?;
    fs::write(directory.join("prompt.md"), prompt.as_bytes())?;
    fs::write(
        directory.join("subtitles.json"),
        serde_json::to_vec_pretty(segments)
            .map_err(|error| StoreError::Validation(error.to_string()))?,
    )?;
    fs::write(
        directory.join("chunks.json"),
        serde_json::to_vec_pretty(chunks)
            .map_err(|error| StoreError::Validation(error.to_string()))?,
    )?;
    fs::write(
        directory.join("result.schema.json"),
        serde_json::to_vec_pretty(&result_schema())
            .map_err(|error| StoreError::Validation(error.to_string()))?,
    )?;
    Ok(())
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_progress_never_authorizes_future_start_times() {
        let segment = |id: &str, start_ms| SubtitleSegment {
            id: id.into(),
            lineage_id: id.into(),
            source_segment_id: None,
            ordinal: 0,
            start_ms,
            end_ms: start_ms + 100,
            text: id.into(),
            confidence: None,
            issue_kind: None,
            words: vec![],
        };
        let authorized = authorized_segments(
            &[segment("past", 900), segment("future", 1_001)],
            AnalysisScope::CurrentProgress,
            Some(1_000),
        );
        assert_eq!(
            authorized
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["past"]
        );
    }

    #[test]
    fn summary_does_not_decode_unselected_history() {
        let (_directory, _store, task) = super::super::test_support::prepared_summary_with_history(true);
        assert_eq!(task.subtitle_version_id, "version");
        assert_eq!(task.chunks[0].segment_ids, vec!["past"]);
    }

    #[test]
    fn prepares_a_recoverable_manual_task_without_future_subtitles() {
        let (_directory, store, task) = super::super::test_support::prepared_summary();
        assert_eq!(task.chunks.len(), 1);
        assert_eq!(task.chunks[0].segment_ids, vec!["past"]);
        assert!(
            std::path::Path::new(&task.materials_directory)
                .join("result.schema.json")
                .is_file()
        );
        SummaryTaskRepository::new(&store)
            .set_task_state(&task.id, "running", "analyzing_chunks", 0.2)
            .unwrap();
        assert_eq!(
            SummaryTaskRepository::new(&store)
                .recover_interrupted()
                .unwrap(),
            1
        );
        assert_eq!(
            SummaryTaskRepository::new(&store)
                .get(&task.id)
                .unwrap()
                .status,
            "interrupted"
        );
    }
}
