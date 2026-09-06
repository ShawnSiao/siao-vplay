use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde_json::Value;

use super::{
    task_types::AiTaskError,
    types::{AiExecutionTarget, ResolvedAiService},
};
use crate::store::ProjectStore;

#[derive(Clone, Copy)]
pub enum AiTaskKind {
    Explanation,
    Learning,
}

use super::active_execution::ApiExecutionLease;

impl AiTaskKind {
    fn table(self) -> &'static str {
        match self {
            Self::Explanation => "explanation_tasks",
            Self::Learning => "learning_tasks",
        }
    }
}

pub(crate) fn record_prepared_service(
    store: &ProjectStore,
    kind: AiTaskKind,
    task_id: &str,
    service: &ResolvedAiService,
    revision: u64,
) -> Result<(), AiTaskError> {
    let revision = i64::try_from(revision).map_err(|_| super::AiError::RevisionConflict)?;
    let changed = store.connect()?.execute(&format!(
        "UPDATE {} SET service_config_id = ?2, service_revision = ?3, provider_id = ?4,
         model_id = ?5, stage = 'awaiting_confirmation' WHERE id = ?1 AND status = 'queued' AND execution_kind = 'api'", kind.table()),
        params![task_id, service.service_config_id, revision, service.provider_id.as_str(), service.model_id])?;
    if changed != 1 {
        return Err(super::AiError::Validation("任务状态已改变，请重新准备".to_owned()).into());
    }
    Ok(())
}

pub fn claim_api(
    store: &ProjectStore,
    kind: AiTaskKind,
    task_id: &str,
    service: &ResolvedAiService,
    service_revision: u64,
    resume: bool,
) -> Result<ApiExecutionLease, AiTaskError> {
    let lease = ApiExecutionLease::acquire(store, task_id)?;
    let expected = if resume {
        "status IN ('failed', 'cancelled', 'interrupted')"
    } else {
        "status = 'queued'"
    };
    let query = format!(
        "UPDATE {}
         SET handoff_kind = 'manual', execution_kind = 'api',
             service_config_id = ?2, service_revision = ?3,
             provider_id = ?4, model_id = ?5,
             provider_request_id = NULL, usage_json = NULL,
             receiver_label = '已选择的 AI 服务',
             status = 'running', stage = 'running', progress = 0.1,
             error_code = NULL, error_message = NULL, cancel_requested_at_ms = NULL,
             started_at_ms = ?6, completed_at_ms = NULL, updated_at_ms = ?6
         WHERE id = ?1 AND {expected}",
        kind.table()
    );
    let service_revision = i64::try_from(service_revision)
        .map_err(|_| super::error::AiError::Validation("AI 服务配置版本超出支持范围".to_owned()))?;
    let changed = store.connect()?.execute(
        &query,
        params![
            task_id,
            service.service_config_id,
            service_revision,
            service.provider_id.as_str(),
            service.model_id,
            now_ms()?
        ],
    )?;
    if changed == 1 {
        Ok(lease)
    } else {
        Err(super::error::AiError::Validation("AI 任务当前状态不允许开始或重试".to_owned()).into())
    }
}

pub fn switch_local(
    store: &ProjectStore,
    kind: AiTaskKind,
    task_id: &str,
    execution: &AiExecutionTarget,
) -> Result<(), AiTaskError> {
    let (legacy, execution_kind, receiver, status, stage) = match execution {
        AiExecutionTarget::Manual => (
            "manual",
            "manual",
            "手动选择的外部 Agent",
            "awaiting_external_result",
            "awaiting_external_result",
        ),
        AiExecutionTarget::Codex => ("codex", "codex", "本机 Codex", "interrupted", "interrupted"),
        AiExecutionTarget::Api { .. } => {
            return Err(super::error::AiError::Validation(
                "API 服务必须通过安全配置解析后重试".to_owned(),
            )
            .into());
        }
    };
    let query = format!(
        "UPDATE {}
         SET handoff_kind = ?2, execution_kind = ?3, receiver_label = ?4,
             service_config_id = NULL, service_revision = NULL,
             provider_id = NULL, model_id = NULL,
             provider_request_id = NULL, usage_json = NULL,
             status = ?5, stage = ?6, progress = 0.0,
             error_code = NULL, error_message = NULL,
             completed_at_ms = NULL, updated_at_ms = ?7
         WHERE id = ?1 AND status IN ('failed', 'cancelled', 'interrupted')",
        kind.table()
    );
    let changed = store.connect()?.execute(
        &query,
        params![
            task_id,
            legacy,
            execution_kind,
            receiver,
            status,
            stage,
            now_ms()?
        ],
    )?;
    if changed == 1 {
        Ok(())
    } else {
        Err(super::error::AiError::Validation("任务当前状态不能切换执行方式".to_owned()).into())
    }
}

pub fn record_provider_output(
    store: &ProjectStore,
    kind: AiTaskKind,
    task_id: &str,
    request_id: Option<&str>,
    usage: Option<&Value>,
) -> Result<(), AiTaskError> {
    let usage_json = usage.map(serde_json::to_string).transpose()?;
    let query = format!(
        "UPDATE {}
         SET provider_request_id = ?2, usage_json = ?3,
             progress = 0.85, updated_at_ms = ?4
         WHERE id = ?1 AND status = 'running' AND cancel_requested_at_ms IS NULL",
        kind.table()
    );
    let changed = store
        .connect()?
        .execute(&query, params![task_id, request_id, usage_json, now_ms()?])?;
    if changed == 1 {
        Ok(())
    } else {
        Err(super::error::AiError::Validation("AI 任务已不再运行".to_owned()).into())
    }
}

pub fn fail(
    store: &ProjectStore,
    kind: AiTaskKind,
    task_id: &str,
    code: &str,
    message: &str,
    request_id: Option<&str>,
) {
    let query = format!(
        "UPDATE {}
         SET status = CASE WHEN cancel_requested_at_ms IS NULL THEN 'failed' ELSE 'cancelled' END,
             stage = CASE WHEN cancel_requested_at_ms IS NULL THEN 'failed' ELSE 'cancelled' END,
             error_code = CASE WHEN cancel_requested_at_ms IS NULL THEN ?2 ELSE NULL END,
             error_message = CASE WHEN cancel_requested_at_ms IS NULL THEN ?3 ELSE NULL END,
             provider_request_id = COALESCE(?4, provider_request_id),
             completed_at_ms = ?5, updated_at_ms = ?5
         WHERE id = ?1 AND status IN ('queued', 'running', 'validating')",
        kind.table()
    );
    let _ = store.connect().and_then(|connection| {
        connection
            .execute(
                &query,
                params![
                    task_id,
                    code,
                    message,
                    request_id,
                    now_ms().unwrap_or_default()
                ],
            )
            .map(|_| ())
            .map_err(Into::into)
    });
}

fn now_ms() -> Result<i64, crate::store::StoreError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| crate::store::StoreError::Validation("系统时间无效".to_owned()))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| crate::store::StoreError::Validation("系统时间超出范围".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_waits_for_the_previous_api_execution_to_release_ownership() {
        use crate::ai::types::{AiProtocol, AiProviderId};
        let fixture = crate::understanding::test_fixture::Fixture::new();
        let task = fixture.prepare_with_options(crate::summary::PromptSelection::default(), false);
        fixture
            .store
            .connect()
            .unwrap()
            .execute(
                "UPDATE explanation_tasks SET status = 'queued' WHERE id = ?1",
                [&task.id],
            )
            .unwrap();
        let service = ResolvedAiService {
            service_config_id: Some("test".into()),
            provider_id: AiProviderId::Openai,
            protocol: AiProtocol::OpenaiResponses,
            base_url: "https://example.invalid".into(),
            model_id: Some("test".into()),
            api_key: "unused-test-key".into(),
        };
        let first = claim_api(
            &fixture.store,
            AiTaskKind::Explanation,
            &task.id,
            &service,
            1,
            false,
        )
        .unwrap();
        fixture.store.connect().unwrap().execute("UPDATE explanation_tasks SET status = 'cancelled', cancel_requested_at_ms = 1 WHERE id = ?1", [&task.id]).unwrap();
        let restarted_too_early = claim_api(
            &fixture.store,
            AiTaskKind::Explanation,
            &task.id,
            &service,
            1,
            true,
        );
        assert!(restarted_too_early.is_err());
        drop(first);
        let _retry = claim_api(
            &fixture.store,
            AiTaskKind::Explanation,
            &task.id,
            &service,
            1,
            true,
        )
        .unwrap();
        assert!(
            !crate::codex_task_state::cancellation_requested(&fixture.store, &task.id).unwrap()
        );
    }
    #[test]
    fn prepared_api_task_records_receiver_without_starting_execution() {
        use crate::ai::types::{AiProtocol, AiProviderId, ResolvedAiService};
        use crate::summary::PromptSelection;
        use crate::understanding::{get_explanation_task, test_fixture::Fixture};
        let fixture = Fixture::new();
        let task = fixture.prepare_with_options(PromptSelection::default(), false);
        fixture.store.connect().unwrap().execute(
            "UPDATE explanation_tasks SET execution_kind = 'api', status = 'queued' WHERE id = ?1", [&task.id],
        ).unwrap();
        let service = ResolvedAiService {
            service_config_id: Some("test-service".into()),
            provider_id: AiProviderId::Openai,
            protocol: AiProtocol::OpenaiResponses,
            base_url: "https://example.invalid".into(),
            model_id: Some("test-model".into()),
            api_key: "unused-test-key".into(),
        };
        record_prepared_service(
            &fixture.store,
            AiTaskKind::Explanation,
            &task.id,
            &service,
            7,
        )
        .unwrap();
        let prepared = get_explanation_task(&fixture.store, &task.id).unwrap();
        assert_eq!(prepared.status, "queued");
        assert_eq!(prepared.stage, "awaiting_confirmation");
        assert_eq!(prepared.execution.service_revision, Some(7));
        assert_eq!(prepared.execution.model_id.as_deref(), Some("test-model"));
        assert!(prepared.execution.provider_request_id.is_none());
    }
}
