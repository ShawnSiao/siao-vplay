use super::*;
use crate::ai::AiError;

#[test]
fn cancelled_summary_never_attempts_to_resolve_or_send_to_a_provider() {
    let (_directory, store, mut task) = super::super::test_support::prepared_summary();
    task.execution_kind = SummaryExecutionKind::Api;
    SummaryTaskRepository::new(&store)
        .request_cancel(&task.id)
        .unwrap();
    let error = run_request(
        &store,
        &task,
        "final",
        None,
        Vec::new(),
        "private material".into(),
        100,
    )
    .unwrap_err();
    assert!(error.to_string().contains("已取消"), "{error}");
}

#[test]
fn retries_only_transient_provider_failures() {
    for error in [
        AiError::Timeout,
        AiError::RateLimited,
        AiError::ProviderUnavailable,
    ] {
        assert_eq!(
            retry_delays(&ProviderFailure {
                error,
                provider_request_id: None
            })
            .len(),
            2
        );
    }
    assert!(
        retry_delays(&ProviderFailure {
            error: AiError::Unauthorized,
            provider_request_id: None
        })
        .is_empty()
    );
}
