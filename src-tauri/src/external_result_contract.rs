use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ExternalAgentResultUpdate {
    #[cfg_attr(test, schemars(with = "ExternalAgentTaskKind"))]
    pub task_kind: String,
    pub task_id: String,
    pub project_id: String,
    #[cfg_attr(test, schemars(with = "ExternalAgentResultStatus"))]
    pub status: String,
    pub output_id: Option<String>,
    pub message: String,
}

#[cfg(test)]
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Wire vocabulary for external task domains")]
enum ExternalAgentTaskKind { Translation, Explanation, Learning }

#[cfg(test)]
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Wire vocabulary for reconciliation statuses")]
enum ExternalAgentResultStatus { Validating, Completed, Rejected }
