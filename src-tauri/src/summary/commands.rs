use serde::Serialize;
use tauri::State;

use super::{
    AnalysisPromptTemplate, DeleteAnalysisPromptTemplateInput, ListAnalysisPromptTemplatesInput,
    PromptTemplateRepository, SaveAnalysisPromptTemplateInput,
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
