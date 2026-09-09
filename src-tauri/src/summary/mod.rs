#[cfg(test)]
mod wire_schema;
mod activity;
#[cfg(test)]
pub(crate) use activity::SummaryActivity;
pub mod commands;

mod backup;
mod chunker;
mod citations;
mod codex_executor;
mod dispatch;
mod execution_prompts;
mod executor;
mod keyframes;
mod markdown_report;
mod materials;
pub(crate) mod migration;
mod model;
mod prompts;
mod report;
#[cfg(test)]
mod report_acceptance_tests;
mod repository;
mod result_model;
mod result_repository;
mod result_validation;
mod retry_policy;
mod schema;
mod task_repository;
mod verified_materials;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
pub(crate) use dispatch::{SummaryDispatchPreview, dispatch_contract_example};

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
