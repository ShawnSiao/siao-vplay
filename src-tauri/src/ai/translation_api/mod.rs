mod execution;
mod policy;
mod repository;
#[cfg(test)]
#[path = "tests.rs"]
mod execution_tests;
#[cfg(test)]
mod confirmation_tests;

use super::{
    connection,
    error::AiCommandError,
    task_execution,
    task_persistence::{self, AiTaskKind},
    task_types::AiTaskError,
    types::AiExecutionTarget,
};
use crate::{
    store::ProjectStore,
    translation::{self, PrepareTranslationTaskInput, TranslationTask},
    translation_dispatch,
};
pub(crate) use repository::{receiver, recover};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareInput {
    pub project_id: String,
    pub source_language_code: String,
    pub target_language_code: String,
    pub segment_ids: Option<Vec<String>>,
    pub execution: AiExecutionTarget,
    pub service_revision: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInput {
    pub task_id: String,
    pub confirmation_sha256: String,
}

pub(crate) fn confirmation_policy() -> Result<serde_json::Value, AiTaskError> {
    Ok(serde_json::to_value(policy::load()?)?)
}

fn prepare(store: &ProjectStore, input: PrepareInput) -> Result<TranslationTask, AiTaskError> {
    let _project_operation = crate::project_operations::Operation::acquire(store, &input.project_id)?;
    let service = connection::resolve_execution(&input.execution, Some(input.service_revision))?;
    let task = translation::prepare_translation_task(
        store,
        PrepareTranslationTaskInput {
            project_id: input.project_id,
            handoff_kind: "api".into(),
            source_language_code: input.source_language_code,
            target_language_code: input.target_language_code,
            segment_ids: input.segment_ids,
        },
    )?;
    let prepared = (|| {
        task_persistence::record_prepared_service(
            store,
            AiTaskKind::Translation,
            &task.id,
            &service,
            input.service_revision,
        )?;
        repository::prepare_batches(store, &task.id, &policy::load()?)?;
        Ok::<_, AiTaskError>(translation::get_translation_task(store, &task.id)?)
    })();
    if let Err(error) = &prepared {
        task_persistence::fail(
            store,
            AiTaskKind::Translation,
            &task.id,
            "translation_prepare_failed",
            &error.to_string(),
            None,
        );
    }
    prepared
}

fn start(store: &ProjectStore, input: StartInput) -> Result<TranslationTask, AiTaskError> {
    translation_dispatch::verify_api(store, &input.task_id, &input.confirmation_sha256)?;
    let receiver = receiver(store, &input.task_id)?;
    let service = connection::resolve_execution(
        &AiExecutionTarget::Api {
            service_config_id: receiver.service_config_id.clone(),
            model_id: receiver.model_id.clone(),
        },
        Some(receiver.service_revision),
    )?;
    let retry = translation::get_translation_task(store, &input.task_id)?.status != "queued";
    let lease = task_persistence::claim_api(
        store,
        AiTaskKind::Translation,
        &input.task_id,
        &service,
        receiver.service_revision,
        retry,
    )?;
    let task = translation::get_translation_task(store, &input.task_id)?;
    task_execution::spawn(
        lease,
        store.clone(),
        input.task_id,
        AiTaskKind::Translation,
        move |store, id| execution::run(store, id, &receiver),
    );
    Ok(task)
}

#[tauri::command]
pub async fn prepare_api_translation(
    store: tauri::State<'_, ProjectStore>,
    input: PrepareInput,
) -> Result<TranslationTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        prepare(&store, input).map_err(AiTaskError::command_error)
    })
    .await
    .map_err(|_| {
        AiCommandError::task(
            "translation_worker_failed",
            "翻译准备未完成".into(),
            true,
            None,
        )
    })?
}
#[tauri::command]
pub async fn start_api_translation(
    store: tauri::State<'_, ProjectStore>,
    input: StartInput,
) -> Result<TranslationTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        start(&store, input).map_err(AiTaskError::command_error)
    })
    .await
    .map_err(|_| {
        AiCommandError::task(
            "translation_worker_failed",
            "翻译启动未完成".into(),
            true,
            None,
        )
    })?
}

#[cfg(test)]
mod tests {
    use crate::translation::{self, PrepareTranslationTaskInput};

    #[test]
    fn api_translation_prepares_without_codex_or_sending_and_records_its_execution_kind() {
        let fixture = translation::fixture::TranslationFixture::new();
        let task = translation::prepare_translation_task(
            &fixture.store,
            PrepareTranslationTaskInput {
                project_id: fixture.project_id,
                handoff_kind: "api".into(),
                source_language_code: "ja".into(),
                target_language_code: "zh-cn".into(),
                segment_ids: None,
            },
        )
        .unwrap();
        assert_eq!(task.handoff_kind, "api");
        assert_eq!(task.status, "queued");
        assert!(task.output_version_id.is_none());
    }
}
