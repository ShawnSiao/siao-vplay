use serde::{Deserialize, Serialize};

use crate::store::StoreError;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisTaskType {
    Understanding,
    Summary,
}

impl AnalysisTaskType {
    pub(crate) fn as_database_value(self) -> &'static str {
        match self {
            Self::Understanding => "understanding",
            Self::Summary => "summary",
        }
    }

    pub(crate) fn from_database(value: &str) -> Result<Self, StoreError> {
        match value {
            "understanding" => Ok(Self::Understanding),
            "summary" => Ok(Self::Summary),
            _ => Err(StoreError::Validation(format!(
                "分析提示词任务类型无效：{value}"
            ))),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisPromptTemplate {
    pub id: String,
    pub task_type: AnalysisTaskType,
    pub base_template_id: String,
    pub name: String,
    pub custom_requirements: String,
    pub is_builtin: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListAnalysisPromptTemplatesInput {
    pub task_type: Option<AnalysisTaskType>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveAnalysisPromptTemplateInput {
    pub id: Option<String>,
    pub task_type: AnalysisTaskType,
    pub base_template_id: String,
    pub name: String,
    pub custom_requirements: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAnalysisPromptTemplateInput {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSnapshot {
    pub schema_version: u32,
    pub task_type: AnalysisTaskType,
    pub system_rules_version: String,
    pub template_id: String,
    pub template_name: String,
    pub base_template_id: String,
    pub template_requirements: String,
    pub one_time_requirements: String,
    pub composed_prompt: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptSelection {
    pub template_id: String,
    #[serde(default)]
    pub one_time_requirements: String,
}

impl Default for PromptSelection {
    fn default() -> Self {
        Self {
            template_id: "builtin:understanding:balanced".to_owned(),
            one_time_requirements: String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_type_uses_stable_database_values() {
        for task_type in [AnalysisTaskType::Understanding, AnalysisTaskType::Summary] {
            assert_eq!(
                AnalysisTaskType::from_database(task_type.as_database_value()).unwrap(),
                task_type
            );
        }
    }
}
