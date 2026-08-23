pub mod commands;

mod backup;
mod chunker;
mod codex_executor;
mod executor;
mod keyframes;
mod materials;
pub(crate) mod migration;
mod model;
mod prompts;
mod report;
#[cfg(test)]
mod report_acceptance_tests;
mod repository;
mod result_repository;
mod result_validation;
mod schema;
mod task_repository;

pub use model::{
    AnalysisPromptTemplate, AnalysisTaskType, DeleteAnalysisPromptTemplateInput,
    ExportVideoSummaryInput, ListAnalysisPromptTemplatesInput, ListSummaryTasksInput,
    ListVideoSummariesInput, PrepareSummaryTaskInput, PromptSelection, PromptSnapshot,
    SaveAnalysisPromptTemplateInput, SummaryExport, SummaryTask, SummaryTaskIdInput, VideoSummary,
    VideoSummaryIdInput,
};

pub(crate) use migration::migrate;
pub(crate) use repository::PromptTemplateRepository;

pub(crate) fn recover_summary_tasks(
    store: &crate::store::ProjectStore,
) -> Result<(), crate::store::StoreError> {
    task_repository::SummaryTaskRepository::new(store).recover_interrupted()?;
    Ok(())
}
