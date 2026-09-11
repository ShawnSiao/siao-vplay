use super::{
    config,
    error::AiCommandError,
    network, probe, task_orchestrator,
    task_types::{ResumeAiTaskInput, StartExplanationTaskInput, StartLearningTaskInput},
    types::{
        AiExecutionPreview, AiModelList, AiServiceProbeInput, AiServiceSettings,
        AiServiceTestResult, DeleteAiServiceInput, NetworkSettings, PreviewAiExecutionInput,
        SaveAiServiceInput, SetDefaultAiServiceInput, SetNetworkSettingsInput,
    },
};
use crate::{
    learning::LearningTask,
    local_resources::SetLocalResourceProxyInput,
    resource_download::{self, ResourceNetworkStatus},
    store::ProjectStore,
    understanding::ExplanationTask,
};
use tauri::State;

#[tauri::command]
pub async fn get_ai_service_settings() -> Result<AiServiceSettings, AiCommandError> {
    run(move || config::store()?.snapshot().map_err(Into::into)).await
}

#[tauri::command]
pub async fn save_ai_service(
    input: SaveAiServiceInput,
) -> Result<AiServiceSettings, AiCommandError> {
    run(move || config::store()?.save(input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn delete_ai_service(
    input: DeleteAiServiceInput,
) -> Result<AiServiceSettings, AiCommandError> {
    run(move || config::store()?.delete(input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn set_default_ai_service(
    input: SetDefaultAiServiceInput,
) -> Result<AiServiceSettings, AiCommandError> {
    run(move || config::store()?.set_default(input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn list_ai_service_models(
    input: AiServiceProbeInput,
) -> Result<AiModelList, AiCommandError> {
    run(move || probe::list_models(input)).await
}

#[tauri::command]
pub async fn test_ai_service(
    input: AiServiceProbeInput,
) -> Result<AiServiceTestResult, AiCommandError> {
    run(move || probe::test_service(input)).await
}

#[tauri::command]
pub async fn preview_ai_execution(
    input: PreviewAiExecutionInput,
) -> Result<AiExecutionPreview, AiCommandError> {
    run(move || probe::preview_execution(input)).await
}

#[tauri::command]
pub async fn prepare_ai_explanation_task(
    store: State<'_, ProjectStore>,
    input: StartExplanationTaskInput,
) -> Result<ExplanationTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        task_orchestrator::prepare_explanation(&store, input)
            .map_err(super::task_types::AiTaskError::command_error)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command]
pub async fn resume_explanation_task(
    store: State<'_, ProjectStore>,
    input: ResumeAiTaskInput,
) -> Result<ExplanationTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        task_orchestrator::resume_explanation(&store, input)
            .map_err(super::task_types::AiTaskError::command_error)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command]
pub async fn prepare_ai_learning_task(
    store: State<'_, ProjectStore>,
    input: StartLearningTaskInput,
) -> Result<LearningTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        task_orchestrator::prepare_learning(&store, input)
            .map_err(super::task_types::AiTaskError::command_error)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command]
pub async fn resume_learning_task(
    store: State<'_, ProjectStore>,
    input: ResumeAiTaskInput,
) -> Result<LearningTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        task_orchestrator::resume_learning(&store, input)
            .map_err(super::task_types::AiTaskError::command_error)
    })
    .await
    .map_err(background_task_error)?
}

fn background_task_error(error: impl std::fmt::Display) -> AiCommandError {
    AiCommandError::task(
        "background_task_failed",
        format!("后台任务未能完成：{error}"),
        true,
        None,
    )
}

#[tauri::command]
pub async fn get_network_settings() -> Result<NetworkSettings, AiCommandError> {
    run(move || network::settings().map_err(Into::into)).await
}

#[tauri::command]
pub async fn set_network_settings(
    input: SetNetworkSettingsInput,
) -> Result<NetworkSettings, AiCommandError> {
    run(move || network::set_settings(input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn get_local_resource_network_status() -> Result<ResourceNetworkStatus, AiCommandError> {
    run(move || resource_download::network_status().map_err(Into::into)).await
}

#[tauri::command]
pub async fn set_local_resource_proxy(
    input: SetLocalResourceProxyInput,
) -> Result<ResourceNetworkStatus, AiCommandError> {
    run(move || {
        network::set_custom_proxy_compat(input.proxy_url.as_deref())
            .map(Into::into)
            .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn preview_ai_task_dispatch(
    store: State<'_, ProjectStore>,
    input: super::dispatch::PreviewTaskDispatchInput,
) -> Result<super::dispatch::TaskDispatchPreview, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        super::dispatch::preview(&store, input.task_kind, &input.task_id)
            .map_err(super::task_types::AiTaskError::command_error)
    })
    .await
    .map_err(background_task_error)?
}

async fn run<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, AiCommandError> + Send + 'static,
) -> Result<T, AiCommandError> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(background_task_error)?
}

#[cfg(test)]
mod worker_tests {
    use super::*;

    #[test]
    fn settings_and_probe_work_leave_the_caller_thread() {
        let caller = std::thread::current().id();
        let worker =
            tauri::async_runtime::block_on(run(|| Ok(std::thread::current().id()))).unwrap();
        assert_ne!(caller, worker);
    }

    #[test]
    fn worker_preserves_structured_provider_failure() {
        let expected = AiCommandError::task("rate_limited", "稍后重试".into(), true, None);
        let expected_json = serde_json::to_value(&expected).unwrap();
        let error = tauri::async_runtime::block_on(run::<()>(move || Err(expected))).unwrap_err();
        assert_eq!(serde_json::to_value(error).unwrap(), expected_json);
    }

    #[test]
    fn worker_panic_returns_retryable_background_error() {
        let error = tauri::async_runtime::block_on(run::<()>(|| panic!("isolated probe worker")))
            .unwrap_err();
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["code"], "background_task_failed");
        assert_eq!(value["retryable"], true);
    }
}
