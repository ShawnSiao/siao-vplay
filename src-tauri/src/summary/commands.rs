use serde::Serialize;
use tauri::State;

use super::{
    AnalysisPromptTemplate, DeleteAnalysisPromptTemplateInput, ExportVideoSummaryInput,
    ListAnalysisPromptTemplatesInput, ListSummaryTasksInput, ListVideoSummariesInput,
    PrepareSummaryTaskInput, PromptTemplateRepository, SaveAnalysisPromptTemplateInput,
    SummaryExport, SummaryTask, SummaryTaskIdInput, VideoSummary, VideoSummaryIdInput, executor,
    materials, report, result_repository::SummaryResultRepository,
    task_repository::SummaryTaskRepository,
};
use crate::store::{ProjectStore, StoreError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryCommandError {
    code: &'static str,
    message: String,
}

impl From<StoreError> for SummaryCommandError {
    fn from(error: StoreError) -> Self {
        let code = match error {
            StoreError::Validation(_) => "validation_failed",
            _ => "summary_store_failed",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

#[tauri::command]
pub fn list_analysis_prompt_templates(
    store: State<'_, ProjectStore>,
    input: ListAnalysisPromptTemplatesInput,
) -> Result<Vec<AnalysisPromptTemplate>, SummaryCommandError> {
    PromptTemplateRepository::new(store.inner())
        .list(input.task_type)
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_analysis_prompt_templates(
    store: State<'_, ProjectStore>,
    input: SaveAnalysisPromptTemplateInput,
) -> Result<AnalysisPromptTemplate, SummaryCommandError> {
    PromptTemplateRepository::new(store.inner())
        .save(input)
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_analysis_prompt_templates(
    store: State<'_, ProjectStore>,
    input: DeleteAnalysisPromptTemplateInput,
) -> Result<(), SummaryCommandError> {
    PromptTemplateRepository::new(store.inner())
        .delete(&input.id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn prepare_summary_task(
    store: State<'_, ProjectStore>,
    input: PrepareSummaryTaskInput,
) -> Result<SummaryTask, SummaryCommandError> {
    materials::prepare(store.inner(), input).map_err(Into::into)
}

#[tauri::command]
pub fn open_summary_materials(
    store: State<'_, ProjectStore>,
    input: SummaryTaskIdInput,
) -> Result<bool, SummaryCommandError> {
    materials::open_materials(store.inner(), &input.task_id).map_err(Into::into)
}

#[tauri::command]
pub fn start_summary_task(
    store: State<'_, ProjectStore>,
    input: SummaryTaskIdInput,
) -> Result<SummaryTask, SummaryCommandError> {
    executor::start_or_resume(store.inner(), &input.task_id).map_err(Into::into)
}

#[tauri::command]
pub fn resume_summary_task(
    store: State<'_, ProjectStore>,
    input: SummaryTaskIdInput,
) -> Result<SummaryTask, SummaryCommandError> {
    executor::start_or_resume(store.inner(), &input.task_id).map_err(Into::into)
}

#[tauri::command]
pub fn cancel_summary_task(
    store: State<'_, ProjectStore>,
    input: SummaryTaskIdInput,
) -> Result<SummaryTask, SummaryCommandError> {
    let repository = SummaryTaskRepository::new(store.inner());
    let task = repository.get(&input.task_id)?;
    if matches!(
        task.status.as_str(),
        "prepared" | "awaiting_external_result" | "paused" | "interrupted"
    ) {
        repository.finish_cancelled(&input.task_id)?;
    } else {
        repository.request_cancel(&input.task_id)?;
    }
    repository.get(&input.task_id).map_err(Into::into)
}

#[tauri::command]
pub fn get_summary_task(
    store: State<'_, ProjectStore>,
    input: SummaryTaskIdInput,
) -> Result<SummaryTask, SummaryCommandError> {
    SummaryTaskRepository::new(store.inner())
        .get(&input.task_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_summary_tasks(
    store: State<'_, ProjectStore>,
    input: ListSummaryTasksInput,
) -> Result<Vec<SummaryTask>, SummaryCommandError> {
    SummaryTaskRepository::new(store.inner())
        .list(&input.project_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_video_summary(
    store: State<'_, ProjectStore>,
    input: VideoSummaryIdInput,
) -> Result<VideoSummary, SummaryCommandError> {
    SummaryResultRepository::new(store.inner())
        .get_summary(&input.summary_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_video_summaries(
    store: State<'_, ProjectStore>,
    input: ListVideoSummariesInput,
) -> Result<Vec<VideoSummary>, SummaryCommandError> {
    SummaryResultRepository::new(store.inner())
        .list_summaries(&input.project_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn export_video_summary(
    store: State<'_, ProjectStore>,
    input: ExportVideoSummaryInput,
) -> Result<SummaryExport, SummaryCommandError> {
    report::export(store.inner(), input).map_err(Into::into)
}

#[tauri::command]
pub async fn list_summary_activity(
    store: State<'_, ProjectStore>,
) -> Result<Vec<super::activity::SummaryActivity>, SummaryCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || super::activity::list(&store))
        .await
        .map_err(|_| SummaryCommandError {
            code: "summary_activity_failed",
            message: "暂时无法读取处理动态".to_owned(),
        })?
        .map_err(Into::into)
}
