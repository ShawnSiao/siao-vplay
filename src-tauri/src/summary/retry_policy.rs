use crate::{ai::AiError, store::StoreError};
use serde::Deserialize;
use std::{
    thread,
    time::{Duration, Instant},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Policy {
    schema_version: u32,
    retry_delays_seconds: Vec<u64>,
    cancellation_poll_ms: u64,
}

impl Policy {
    pub fn delay_for(&self, error: &AiError, attempt: usize) -> Option<Duration> {
        if !matches!(
            error,
            AiError::Timeout | AiError::RateLimited | AiError::ProviderUnavailable
        ) {
            return None;
        }
        self.retry_delays_seconds
            .get(attempt)
            .copied()
            .map(Duration::from_secs)
    }

    pub fn wait(
        &self,
        delay: Duration,
        mut cancelled: impl FnMut() -> Result<bool, StoreError>,
    ) -> Result<(), StoreError> {
        let start = Instant::now();
        loop {
            if cancelled()? {
                return Err(StoreError::Validation("总结任务已请求取消".into()));
            }
            let remaining = delay.saturating_sub(start.elapsed());
            if remaining.is_zero() {
                return Ok(());
            }
            thread::sleep(remaining.min(Duration::from_millis(self.cancellation_poll_ms)));
        }
    }
}

fn parse(source: &str) -> Result<Policy, StoreError> {
    let invalid = || StoreError::Validation("总结重试配置无效".into());
    let policy: Policy = serde_json::from_str(source).map_err(|_| invalid())?;
    if policy.schema_version != 1
        || policy.retry_delays_seconds.len() > 8
        || policy
            .retry_delays_seconds
            .iter()
            .any(|delay| !(1..=120).contains(delay))
        || !(25..=250).contains(&policy.cancellation_poll_ms)
    {
        return Err(invalid());
    }
    Ok(policy)
}

pub(super) fn load() -> Result<Policy, StoreError> {
    parse(include_str!("retry-policy.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_during_backoff_returns_before_the_retry_delay() {
        let start = Instant::now();
        let mut checks = 0;
        let result = load().unwrap().wait(Duration::from_secs(2), || {
            checks += 1;
            Ok(checks > 1)
        });
        assert!(result.is_err());
        assert!(
            start.elapsed() < Duration::from_secs(1),
            "cancel waited for full retry delay"
        );
    }
    #[test]
    fn defaults_preserve_backoff_and_only_retry_transient_failures() {
        let policy = load().unwrap();
        for error in [
            AiError::Timeout,
            AiError::RateLimited,
            AiError::ProviderUnavailable,
        ] {
            assert_eq!(policy.delay_for(&error, 0), Some(Duration::from_secs(2)));
            assert_eq!(policy.delay_for(&error, 1), Some(Duration::from_secs(5)));
            assert_eq!(policy.delay_for(&error, 2), None);
        }
        for error in [
            AiError::Unauthorized,
            AiError::Cancelled,
            AiError::ConfigurationRead,
        ] {
            assert_eq!(policy.delay_for(&error, 0), None);
        }
    }
    #[test]
    fn configured_delays_and_disabled_retries_are_supported() {
        let policy =
            parse(r#"{"schemaVersion":1,"retryDelaysSeconds":[1,120],"cancellationPollMs":25}"#)
                .unwrap();
        assert_eq!(
            policy.delay_for(&AiError::Timeout, 1),
            Some(Duration::from_secs(120))
        );
        let disabled =
            parse(r#"{"schemaVersion":1,"retryDelaysSeconds":[],"cancellationPollMs":250}"#)
                .unwrap();
        assert_eq!(disabled.delay_for(&AiError::Timeout, 0), None);
    }
    #[test]
    fn rejects_unknown_versions_fields_types_and_unbounded_values() {
        for (field, value) in [
            ("schemaVersion", serde_json::json!(2)),
            ("extra", serde_json::json!(true)),
            ("retryDelaysSeconds", serde_json::json!([0])),
            ("retryDelaysSeconds", serde_json::json!([121])),
            ("retryDelaysSeconds", serde_json::json!([1.5])),
            ("retryDelaysSeconds", serde_json::json!(vec![1; 9])),
            ("cancellationPollMs", serde_json::json!(0)),
            ("cancellationPollMs", serde_json::json!(251)),
            ("cancellationPollMs", serde_json::json!("100")),
        ] {
            let mut data: serde_json::Value =
                serde_json::from_str(include_str!("retry-policy.json")).unwrap();
            data[field] = value;
            assert!(parse(&data.to_string()).is_err(), "{field}");
        }
        assert!(parse("{}").is_err());
    }
    #[test]
    fn successful_wait_does_not_retry_before_its_delay() {
        let start = Instant::now();
        let delay = Duration::from_millis(10);
        load().unwrap().wait(delay, || Ok(false)).unwrap();
        assert!(start.elapsed() >= delay);
    }
    #[test]
    fn cancellation_and_storage_failure_stop_without_sleeping() {
        let policy = load().unwrap();
        assert!(policy.wait(Duration::ZERO, || Ok(true)).is_err());
        let error = policy
            .wait(Duration::from_secs(2), || {
                Err(StoreError::Validation("read failed".into()))
            })
            .unwrap_err();
        assert!(error.to_string().contains("read failed"));
        assert!(policy.wait(Duration::ZERO, || Ok(false)).is_ok());
    }
}
