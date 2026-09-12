use super::AiError;
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RequestPolicy {
    pub max_output_tokens: u32,
    timeout_seconds: u64,
}

impl RequestPolicy {
    pub fn timeout(self) -> Duration {
        Duration::from_secs(self.timeout_seconds)
    }

    fn valid(self) -> bool {
        (256..=32_000).contains(&self.max_output_tokens)
            && (10..=600).contains(&self.timeout_seconds)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Policy {
    schema_version: u32,
    pub explanation: RequestPolicy,
    pub learning: RequestPolicy,
}

fn parse(source: &str) -> Result<Policy, AiError> {
    let invalid = || AiError::Validation("解释与学习执行配置无效".into());
    let policy: Policy = serde_json::from_str(source).map_err(|_| invalid())?;
    if policy.schema_version != 1 || !policy.explanation.valid() || !policy.learning.valid() {
        return Err(invalid());
    }
    Ok(policy)
}

pub(super) fn load() -> Result<Policy, AiError> {
    parse(include_str!("interactive-policy.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_version_is_required_and_only_version_one_is_supported() {
        let mut data: serde_json::Value = serde_json::from_str(include_str!("interactive-policy.json")).unwrap();
        data["schemaVersion"] = serde_json::json!(1);
        assert!(parse(&data.to_string()).is_ok());
        for version in [serde_json::json!(0), serde_json::json!(2), serde_json::json!("1"), serde_json::Value::Null] {
            data["schemaVersion"] = version;
            assert!(parse(&data.to_string()).is_err());
        }
        data.as_object_mut().unwrap().remove("schemaVersion");
        assert!(parse(&data.to_string()).is_err());
    }

    #[test]
    fn default_policy_preserves_existing_request_limits() {
        let policy = load().unwrap();
        for request in [policy.explanation, policy.learning] {
            assert_eq!(request.max_output_tokens, 2048);
            assert_eq!(request.timeout(), Duration::from_secs(90));
        }
    }

    #[test]
    fn domains_can_be_configured_independently() {
        let policy = parse(r#"{"schemaVersion":1,"explanation":{"maxOutputTokens":4096,"timeoutSeconds":180},"learning":{"maxOutputTokens":1024,"timeoutSeconds":30}}"#).unwrap();
        assert_eq!(policy.explanation.max_output_tokens, 4096);
        assert_eq!(policy.explanation.timeout(), Duration::from_secs(180));
        assert_eq!(policy.learning.max_output_tokens, 1024);
        assert_eq!(policy.learning.timeout(), Duration::from_secs(30));
    }

    #[test]
    fn malformed_missing_unknown_or_unbounded_values_are_rejected() {
        for domain in ["explanation", "learning"] {
            for (field, value) in [
                ("maxOutputTokens", serde_json::json!(0)),
                ("maxOutputTokens", serde_json::json!(32001)),
                ("timeoutSeconds", serde_json::json!(0)),
                ("timeoutSeconds", serde_json::json!(601)),
                ("timeoutSeconds", serde_json::json!(1.5)),
                ("timeoutSeconds", serde_json::json!("90")),
                ("unknown", serde_json::json!(1)),
            ] {
                let mut value_json: serde_json::Value = serde_json::from_str(include_str!("interactive-policy.json")).unwrap();
                value_json[domain][field] = value;
                assert!(parse(&value_json.to_string()).is_err(), "{domain}.{field}");
            }
        }
        for source in ["{", "{}", r#"{"explanation":{}}"#] {
            assert!(parse(source).is_err());
        }
    }
}
