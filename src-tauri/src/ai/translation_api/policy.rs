use super::super::{AiError, task_types::AiTaskError};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Policy {
    pub max_segments_per_batch: usize,
    pub max_source_characters_per_batch: usize,
    pub max_output_tokens: u32,
    pub timeout_seconds: u64,
    pub system: String,
}

pub(super) fn load() -> Result<Policy, AiTaskError> {
    let policy: Policy = serde_json::from_str(include_str!("policy.json"))?;
    if !(1..=80).contains(&policy.max_segments_per_batch)
        || !(100..=100_000).contains(&policy.max_source_characters_per_batch)
        || !(1024..=32_000).contains(&policy.max_output_tokens)
        || !(10..=600).contains(&policy.timeout_seconds)
        || policy.system.trim().is_empty()
    {
        return Err(AiError::Validation("翻译执行配置无效".into()).into());
    }
    Ok(policy)
}
