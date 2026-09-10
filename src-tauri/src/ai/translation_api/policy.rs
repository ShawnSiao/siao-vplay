use super::super::{AiError, task_types::AiTaskError};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Policy {
    schema_version: u32,
    pub max_segments_per_batch: usize,
    pub max_source_characters_per_batch: usize,
    pub max_output_tokens: u32,
    pub timeout_seconds: u64,
    pub system: String,
}

pub(super) fn load() -> Result<Policy, AiTaskError> {
    parse(include_str!("policy.json"))
}

fn parse(source: &str) -> Result<Policy, AiTaskError> {
    let policy: Policy = serde_json::from_str(source)?;
    if policy.schema_version != 1 || !(1..=80).contains(&policy.max_segments_per_batch)
        || !(100..=100_000).contains(&policy.max_source_characters_per_batch)
        || !(1024..=32_000).contains(&policy.max_output_tokens)
        || !(10..=600).contains(&policy.timeout_seconds)
        || policy.system.trim().is_empty()
    {
        return Err(AiError::Validation("翻译执行配置无效".into()).into());
    }
    Ok(policy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn version_one_round_trips_into_confirmation_material() {
        let mut source: Value = serde_json::from_str(include_str!("policy.json")).unwrap();
        source["schemaVersion"] = json!(1);
        let policy = parse(&source.to_string()).unwrap();
        assert_eq!(serde_json::to_value(policy).unwrap(), source);
        assert_eq!(super::super::confirmation_policy().unwrap()["schemaVersion"], 1);
    }

    #[test]
    fn missing_or_unsupported_versions_are_rejected() {
        let source: Value = serde_json::from_str(include_str!("policy.json")).unwrap();
        for version in [json!(0), json!(2), json!("1"), Value::Null] {
            let mut data = source.clone();
            data["schemaVersion"] = version;
            assert!(parse(&data.to_string()).is_err());
        }
        let mut data = source;
        data.as_object_mut().unwrap().remove("schemaVersion");
        assert!(parse(&data.to_string()).is_err());
    }

    #[test]
    fn defaults_and_invalid_limits_are_checked() {
        let policy = load().unwrap();
        assert_eq!(policy.max_segments_per_batch, 16);
        assert_eq!(policy.max_source_characters_per_batch, 12000);
        assert_eq!(policy.max_output_tokens, 12000);
        assert_eq!(policy.timeout_seconds, 180);
        for (field, value) in [("maxSegmentsPerBatch", json!(0)), ("maxSegmentsPerBatch", json!(81)),
            ("maxSourceCharactersPerBatch", json!(99)), ("maxSourceCharactersPerBatch", json!(100001)),
            ("maxOutputTokens", json!(1023)), ("maxOutputTokens", json!(32001)),
            ("timeoutSeconds", json!(9)), ("timeoutSeconds", json!(601)), ("system", json!(" ")),
            ("extra", json!(true)), ("timeoutSeconds", json!("180"))] {
            let mut data: Value = serde_json::from_str(include_str!("policy.json")).unwrap();
            data[field] = value;
            assert!(parse(&data.to_string()).is_err(), "{field}");
        }
    }
}
