use serde::Serialize;
use tauri::State;

use super::dispatch::{self, ConfirmedSummaryInput, SummaryDispatchPreview};
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
pub async fn list_analysis_prompt_templates(
    store: State<'_, ProjectStore>,
    input: ListAnalysisPromptTemplatesInput,
) -> Result<Vec<AnalysisPromptTemplate>, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || PromptTemplateRepository::new(&store).list(input.task_type)).await
}

#[tauri::command]
pub async fn save_analysis_prompt_templates(
    store: State<'_, ProjectStore>,
    input: SaveAnalysisPromptTemplateInput,
) -> Result<AnalysisPromptTemplate, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || PromptTemplateRepository::new(&store).save(input)).await
}

#[tauri::command]
pub async fn delete_analysis_prompt_templates(
    store: State<'_, ProjectStore>,
    input: DeleteAnalysisPromptTemplateInput,
) -> Result<(), SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || PromptTemplateRepository::new(&store).delete(&input.id)).await
}

#[tauri::command]
pub async fn prepare_summary_task(
    store: State<'_, ProjectStore>,
    input: PrepareSummaryTaskInput,
) -> Result<SummaryTask, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || materials::prepare(&store, input)).await
}

#[tauri::command]
pub async fn open_summary_materials(
    store: State<'_, ProjectStore>,
    input: SummaryTaskIdInput,
) -> Result<bool, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || materials::open_materials(&store, &input.task_id)).await
}

#[tauri::command]
pub async fn start_summary_task(
    store: State<'_, ProjectStore>,
    input: ConfirmedSummaryInput,
) -> Result<SummaryTask, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || {
        dispatch::verify(&store, &input)?;
        executor::start_or_resume(&store, &input.task_id)
    })
    .await
}

#[tauri::command]
pub async fn resume_summary_task(
    store: State<'_, ProjectStore>,
    input: ConfirmedSummaryInput,
) -> Result<SummaryTask, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || {
        dispatch::verify(&store, &input)?;
        executor::start_or_resume(&store, &input.task_id)
    })
    .await
}

#[tauri::command]
pub async fn cancel_summary_task(
    store: State<'_, ProjectStore>,
    input: SummaryTaskIdInput,
) -> Result<SummaryTask, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || cancel_task(&store, &input.task_id)).await
}

fn cancel_task(store: &ProjectStore, task_id: &str) -> Result<SummaryTask, StoreError> {
    let repository = SummaryTaskRepository::new(store);
    let task = repository.get(task_id)?;
    if matches!(
        task.status.as_str(),
        "prepared" | "awaiting_external_result" | "paused" | "interrupted" | "failed"
    ) {
        repository.finish_cancelled(task_id)?;
    } else {
        repository.request_cancel(task_id)?;
    }
    repository.get(task_id)
}

#[tauri::command]
pub async fn get_summary_task(
    store: State<'_, ProjectStore>,
    input: SummaryTaskIdInput,
) -> Result<SummaryTask, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || SummaryTaskRepository::new(&store).get(&input.task_id)).await
}

#[tauri::command]
pub async fn list_summary_tasks(
    store: State<'_, ProjectStore>,
    input: ListSummaryTasksInput,
) -> Result<Vec<SummaryTask>, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || SummaryTaskRepository::new(&store).list(&input.project_id)).await
}

#[tauri::command]
pub async fn get_video_summary(
    store: State<'_, ProjectStore>,
    input: VideoSummaryIdInput,
) -> Result<VideoSummary, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || SummaryResultRepository::new(&store).get_summary(&input.summary_id)).await
}

#[tauri::command]
pub async fn list_video_summaries(
    store: State<'_, ProjectStore>,
    input: ListVideoSummariesInput,
) -> Result<Vec<VideoSummary>, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || SummaryResultRepository::new(&store).list_summaries(&input.project_id))
        .await
}

#[tauri::command]
pub async fn export_video_summary(
    store: State<'_, ProjectStore>,
    input: ExportVideoSummaryInput,
) -> Result<SummaryExport, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || report::export(&store, input))
        .await
        .map_err(|mut error| {
            if error.code == "summary_background_failed" {
                error.code = "summary_export_unconfirmed";
                error.message =
                    "报告导出意外中断，保存结果尚未确认。请先检查所选目录，避免重复导出。"
                        .to_owned();
            }
            error
        })
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

async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, StoreError> + Send + 'static,
) -> Result<T, SummaryCommandError> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| SummaryCommandError {
            code: "summary_background_failed",
            message: "总结后台操作意外中断，可以重新尝试".to_owned(),
        })?
        .map_err(Into::into)
}

#[tauri::command]
pub async fn preview_summary_dispatch(
    store: State<'_, ProjectStore>,
    input: SummaryTaskIdInput,
) -> Result<SummaryDispatchPreview, SummaryCommandError> {
    let store = store.inner().clone();
    run_blocking(move || dispatch::preview(&store, &input.task_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_summary_can_be_cancelled_without_discarding_completed_chunks() {
        let (_directory, store, task) = super::super::test_support::prepared_summary();
        let repository = SummaryTaskRepository::new(&store);
        let results = SummaryResultRepository::new(&store);
        let result = serde_json::from_value(serde_json::json!({
            "title": "saved", "overview": "completed chunk"
        })).unwrap();
        results.save_chunk(&task.chunks[0].id, &result).unwrap();
        repository.fail(&task.id, "provider_failed", "连接失败").unwrap();
        let cancelled = cancel_task(&store, &task.id).unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.chunks[0].status, "completed");
        assert_eq!(results.completed_chunk_results(&task.id).unwrap()[0].overview, "completed chunk");
        assert!(repository.claim_for_execution(&task.id).is_err());
        assert_eq!(cancel_task(&store, &task.id).unwrap().status, "cancelled");
    }

    #[test]
    fn export_command_returns_a_future_instead_of_blocking_the_dispatcher() {
        fn assert_async<F, R>(_: F)
        where
            F: FnOnce(State<'static, ProjectStore>, ExportVideoSummaryInput) -> R,
            R: std::future::Future<Output = Result<SummaryExport, SummaryCommandError>>,
        {
        }
        assert_async(export_video_summary);
    }

    #[test]
    fn blocking_work_runs_off_the_calling_thread() {
        let caller = std::thread::current().id();
        let worker =
            tauri::async_runtime::block_on(run_blocking(|| Ok(std::thread::current().id())))
                .unwrap();
        assert_ne!(caller, worker);
    }

    #[test]
    fn blocking_work_preserves_validation_errors() {
        let error = tauri::async_runtime::block_on(run_blocking::<()>(|| {
            Err(StoreError::Validation(
                "请选择已存在的报告保存目录".to_owned(),
            ))
        }))
        .unwrap_err();
        assert_eq!(error.code, "validation_failed");
        assert!(error.message.contains("请选择已存在的报告保存目录"));
    }
}
