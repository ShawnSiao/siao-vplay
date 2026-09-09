use super::AiError;
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Policy {
    connect_timeout_seconds: u64,
    model_list_timeout_seconds: u64,
    probe_timeout_seconds: u64,
    pub probe_max_output_tokens: u32,
    summary_timeout_seconds: u64,
}

impl Policy {
    pub fn connect_timeout(&self, request_timeout: Duration) -> Duration {
        request_timeout.min(Duration::from_secs(self.connect_timeout_seconds))
    }
    pub fn model_list_timeout(&self) -> Duration {
        Duration::from_secs(self.model_list_timeout_seconds)
    }
    pub fn probe_timeout(&self) -> Duration {
        Duration::from_secs(self.probe_timeout_seconds)
    }
    pub fn summary_timeout(&self) -> Duration {
        Duration::from_secs(self.summary_timeout_seconds)
    }
}

fn parse(source: &str) -> Result<Policy, AiError> {
    let invalid = || AiError::Validation("AI 请求连接配置无效".into());
    let policy: Policy = serde_json::from_str(source).map_err(|_| invalid())?;
    if !(1..=120).contains(&policy.connect_timeout_seconds)
        || ![policy.model_list_timeout_seconds, policy.probe_timeout_seconds, policy.summary_timeout_seconds]
            .iter().all(|value| (10..=600).contains(value))
        || !(64..=4096).contains(&policy.probe_max_output_tokens)
    {
        return Err(invalid());
    }
    Ok(policy)
}

pub(super) fn load() -> Result<Policy, AiError> {
    parse(include_str!("transport-policy.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_preserve_limits_and_connection_never_exceeds_request_deadline() {
        let policy = load().unwrap();
        assert_eq!(policy.model_list_timeout(), Duration::from_secs(90));
        assert_eq!(policy.probe_timeout(), Duration::from_secs(90));
        assert_eq!(policy.summary_timeout(), Duration::from_secs(180));
        assert_eq!(policy.probe_max_output_tokens, 256);
        assert_eq!(policy.connect_timeout(Duration::from_secs(90)), Duration::from_secs(30));
        assert_eq!(policy.connect_timeout(Duration::from_secs(2)), Duration::from_secs(2));
    }
    #[test]
    fn rejects_missing_unknown_wrong_type_and_unbounded_values() {
        for field in ["connectTimeoutSeconds", "modelListTimeoutSeconds", "probeTimeoutSeconds", "summaryTimeoutSeconds", "probeMaxOutputTokens"] {
            for value in [serde_json::json!(0), serde_json::json!(99999), serde_json::json!("90"), serde_json::Value::Null] {
                let mut data: serde_json::Value = serde_json::from_str(include_str!("transport-policy.json")).unwrap();
                data[field] = value;
                assert!(parse(&data.to_string()).is_err(), "{field}");
            }
        }
        let mut data: serde_json::Value = serde_json::from_str(include_str!("transport-policy.json")).unwrap();
        data["extra"] = true.into();
        assert!(parse(&data.to_string()).is_err());
        assert!(parse("{}").is_err());
    }
}
