use std::{
    collections::{HashMap, HashSet},
    fs, thread,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};

use crate::{
    ai::{
        providers::ProviderFailure,
        summary_provider::{self, SummaryProviderInput},
    },
    codex_runner,
    store::{ProjectStore, StoreError},
};

use super::{
    codex_executor, execution_prompts,
    model::{SummaryExecutionKind, SummaryResult, SummaryTask},
    result_repository::SummaryResultRepository,
    result_validation::{result_schema, validate_chunk_result, validate_final_result},
    task_repository::SummaryTaskRepository,
    verified_materials::{self, VerifiedFrame},
};

const SYSTEM: &str = "只使用任务提供的授权材料。视频主张不等于外部事实。直接证据必须引用有效字幕 ID；无直接依据的内容只能标为 AI 推导或待外部验证。只返回符合 Schema 的 JSON。";

#[derive(Debug, thiserror::Error)]
pub(crate) enum SummaryExecutionError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("AI 服务调用失败：{message}")]
    Provider { code: &'static str, message: String },
    #[error("Codex 执行失败：{0}")]
    Codex(#[from] codex_runner::CodexRunnerError),
}

impl SummaryExecutionError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Store(StoreError::Validation(_)) => "summary_result_invalid",
            Self::Store(_) => "summary_store_failed",
            Self::Provider { code, .. } => code,
            Self::Codex(error) => error.code(),
        }
    }
}

pub(crate) fn start_or_resume(
    store: &ProjectStore,
    task_id: &str,
) -> Result<SummaryTask, StoreError> {
    let repository = SummaryTaskRepository::new(store);
    let task = repository.get(task_id)?;
    let project_operation = crate::project_operations::Operation::acquire(store, &task.project_id)?;
    verified_materials::load(store, &task)?;
    if repository.translation_is_active()? {
        return Err(StoreError::Validation(
            "存在活动翻译任务，完成或取消翻译后才能启动视频总结".to_owned(),
        ));
    }
    if !matches!(
        task.status.as_str(),
        "prepared" | "interrupted" | "failed" | "paused"
    ) && !(task.execution_kind == SummaryExecutionKind::Manual
        && task.status == "awaiting_external_result")
    {
        return Err(StoreError::Validation(format!(
            "总结任务当前状态不可启动：{}",
            task.status
        )));
    }
    repository.claim_for_execution(task_id)?;
    if task.execution_kind == SummaryExecutionKind::Manual {
        return resume_manual(store, &task).inspect_err(|error| {
            let _ = repository.fail(task_id, "summary_result_invalid", &error.to_string());
        });
    }
    launch_worker(store, task_id, project_operation, |worker| {
        thread::Builder::new().spawn(worker).map(|_| ())
    })?;
    repository.get(task_id)
}

fn launch_worker(
    store: &ProjectStore,
    task_id: &str,
    project_operation: crate::project_operations::Operation,
    spawn: impl FnOnce(Box<dyn FnOnce() + Send>) -> std::io::Result<()>,
) -> Result<(), StoreError> {
    let worker_store = store.clone();
    let worker_task_id = task_id.to_owned();
    let launched = spawn(Box::new(move || {
        let _project_operation = project_operation;
        if let Err(error) = execute(&worker_store, &worker_task_id) {
            let repository = SummaryTaskRepository::new(&worker_store);
            if repository
                .get(&worker_task_id)
                .is_ok_and(|task| task.cancel_requested)
            {
                let _ = repository.finish_cancelled(&worker_task_id);
            } else {
                let _ = repository.fail(&worker_task_id, error.code(), &error.to_string());
            }
        }
    }));
    if let Err(error) = launched {
        let message = format!("无法启动总结任务，请稍后重试：{error}");
        SummaryTaskRepository::new(store).fail(task_id, "summary_worker_start_failed", &message)?;
        return Err(std::io::Error::new(error.kind(), message).into());
    }
    Ok(())
}

fn execute(store: &ProjectStore, task_id: &str) -> Result<(), SummaryExecutionError> {
    let tasks = SummaryTaskRepository::new(store);
    tasks.set_task_state(task_id, "running", "analyzing_chunks", 0.0)?;
    let mut task = tasks.get(task_id)?;
    let materials = verified_materials::load(store, &task)?;
    let by_id = materials
        .segments
        .iter()
        .map(|segment| (segment.id.clone(), segment))
        .collect::<HashMap<_, _>>();
    let total = task.chunks.len();
    for chunk in task
        .chunks
        .iter()
        .filter(|chunk| chunk.status != "completed")
    {
        let allowed = chunk
            .segment_ids
            .iter()
            .chain(&chunk.context_segment_ids)
            .cloned()
            .collect::<HashSet<_>>();
        let material = chunk
            .context_segment_ids
            .iter()
            .chain(&chunk.segment_ids)
            .filter_map(|id| by_id.get(id).copied())
            .collect::<Vec<_>>();
        SummaryResultRepository::new(store).begin_chunk(&chunk.id)?;
        let prompt = execution_prompts::chunk(&task, chunk.ordinal, &material)?;
        let images = materials
            .frames
            .iter()
            .filter(|frame| frame.metadata.ordinal == chunk.ordinal)
            .cloned()
            .collect();
        let raw = run_request(
            store,
            &task,
            &format!("chunk-{}", chunk.ordinal),
            Some(&chunk.id),
            images,
            prompt,
            4_096,
        )?;
        if tasks.get(task_id)?.cancel_requested {
            tasks.finish_cancelled(task_id)?;
            return Ok(());
        }
        let result: SummaryResult = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
            .map_err(|error| StoreError::Validation(format!("分块结果 JSON 无效：{error}")))?;
        validate_chunk_result(&result, &allowed, task.playback_cutoff_ms, chunk.ordinal)?;
        SummaryResultRepository::new(store).save_chunk(&chunk.id, &result)?;
        let progress = (chunk.ordinal + 1) as f64 / (total + 1) as f64;
        tasks.set_task_state(task_id, "running", "analyzing_chunks", progress)?;
    }
    task = tasks.get(task_id)?;
    tasks.set_task_state(
        task_id,
        "validating",
        "synthesizing",
        total as f64 / (total + 1) as f64,
    )?;
    let chunk_results = SummaryResultRepository::new(store).completed_chunk_results(task_id)?;
    if chunk_results.len() != total {
        return Err(StoreError::Validation("并非所有总结分块均已通过校验".to_owned()).into());
    }
    let final_prompt = execution_prompts::final_synthesis(&task, &chunk_results)?;
    let raw = run_request(
        store,
        &task,
        "final",
        None,
        Vec::new(),
        final_prompt,
        12_288,
    )?;
    if tasks.get(task_id)?.cancel_requested {
        tasks.finish_cancelled(task_id)?;
        return Ok(());
    }
    let result: SummaryResult = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| StoreError::Validation(format!("最终总结 JSON 无效：{error}")))?;
    let allowed = task
        .chunks
        .iter()
        .flat_map(|chunk| chunk.segment_ids.iter().cloned())
        .collect();
    let required_chunk_ids = task
        .chunks
        .iter()
        .map(|chunk| chunk.segment_ids.iter().cloned().collect())
        .collect::<Vec<HashSet<String>>>();
    let require_examples = chunk_results
        .iter()
        .any(|chunk| !chunk.examples_and_scenarios.is_empty());
    validate_final_result(
        &result,
        &allowed,
        task.playback_cutoff_ms,
        &required_chunk_ids,
        require_examples,
        task.analysis_mode,
    )?;
    let visual_used = !materials.frames.is_empty();
    SummaryResultRepository::new(store).save_summary(task_id, &result, visual_used)?;
    Ok(())
}

fn run_request(
    store: &ProjectStore,
    task: &SummaryTask,
    run_name: &str,
    chunk_id: Option<&str>,
    images: Vec<VerifiedFrame>,
    prompt: String,
    budget: u32,
) -> Result<String, SummaryExecutionError> {
    if crate::codex_task_state::cancellation_requested(store, &task.id)? {
        return Err(StoreError::Validation("总结任务已取消".to_owned()).into());
    }
    match task.execution_kind {
        SummaryExecutionKind::Api => run_api(store, task, chunk_id, images, prompt, budget),
        SummaryExecutionKind::Codex => {
            let directory = SummaryTaskRepository::new(store)
                .materials_directory(&task.id)
                .join("runs")
                .join(run_name);
            fs::create_dir_all(&directory).map_err(StoreError::from)?;
            let isolated_images = images
                .iter()
                .enumerate()
                .map(|(index, source)| {
                    let target = directory.join(format!("frame-{:03}.jpg", index + 1));
                    fs::write(&target, source.bytes.as_slice())?;
                    Ok(target)
                })
                .collect::<Result<Vec<_>, StoreError>>()?;
            Ok(codex_executor::invoke(
                store,
                &task.id,
                &directory,
                prompt,
                &result_schema(),
                &isolated_images,
            )?)
        }
        SummaryExecutionKind::Manual => {
            Err(StoreError::Validation("手动任务不应进入自动执行器".to_owned()).into())
        }
    }
}

fn run_api(
    store: &ProjectStore,
    task: &SummaryTask,
    chunk_id: Option<&str>,
    images: Vec<VerifiedFrame>,
    prompt: String,
    budget: u32,
) -> Result<String, SummaryExecutionError> {
    let service = task
        .service_config_id
        .as_deref()
        .ok_or_else(|| StoreError::Validation("总结任务缺少 AI 服务".to_owned()))?;
    let revision = task
        .service_revision
        .ok_or_else(|| StoreError::Validation("总结任务缺少服务版本".to_owned()))?;
    let model = task
        .model_id
        .as_deref()
        .ok_or_else(|| StoreError::Validation("总结任务缺少模型".to_owned()))?;
    let image_data_urls = images
        .iter()
        .map(|frame| {
            format!(
                "data:image/jpeg;base64,{}",
                STANDARD.encode(frame.bytes.as_slice())
            )
        })
        .collect::<Vec<_>>();
    let policy = super::retry_policy::load()?;
    let mut retry = 0;
    loop {
        let response = summary_provider::generate(
            SummaryProviderInput {
                service_config_id: service,
                service_revision: revision,
                model_id: model,
                system: SYSTEM,
                prompt: prompt.clone(),
                schema_name: "video_summary",
                schema: result_schema(),
                max_output_tokens: budget,
                image_data_urls: image_data_urls.clone(),
            },
            store,
            &task.id,
        );
        match response {
            Ok(output) => return Ok(output.output_text),
            Err(failure) => {
                let Some(delay) = policy.delay_for(&failure.error, retry) else {
                    return Err(provider_error(failure));
                };
                if SummaryTaskRepository::new(store).cancellation_requested(&task.id)?
                {
                    return Err(StoreError::Validation("总结任务已请求取消".to_owned()).into());
                }
                retry += 1;
                if let Some(chunk_id) = chunk_id {
                    SummaryResultRepository::new(store).update_retry(
                        chunk_id,
                        retry as u8,
                        failure.error.code(),
                        &failure.error.to_string(),
                    )?;
                }
                policy.wait(delay, || {
                    SummaryTaskRepository::new(store).cancellation_requested(&task.id)
                })?;
            }
        }
    }
}

fn provider_error(failure: ProviderFailure) -> SummaryExecutionError {
    SummaryExecutionError::Provider {
        code: failure.error.code(),
        message: failure.error.to_string(),
    }
}

fn resume_manual(store: &ProjectStore, task: &SummaryTask) -> Result<SummaryTask, StoreError> {
    let repository = SummaryTaskRepository::new(store);
    let result_path = repository.materials_directory(&task.id).join("result.json");
    if !result_path.is_file() {
        repository.set_task_state(
            &task.id,
            "awaiting_external_result",
            "awaiting_external_result",
            task.progress,
        )?;
        return repository.get(&task.id);
    }
    repository.set_task_state(&task.id, "validating", "validating", task.progress)?;
    let result: SummaryResult = serde_json::from_slice(&fs::read(result_path)?)
        .map_err(|error| StoreError::Validation(format!("手动总结结果无效：{error}")))?;
    let allowed = task
        .chunks
        .iter()
        .flat_map(|chunk| chunk.segment_ids.iter().cloned())
        .collect();
    let required_chunk_ids = task
        .chunks
        .iter()
        .map(|chunk| chunk.segment_ids.iter().cloned().collect())
        .collect::<Vec<HashSet<String>>>();
    validate_final_result(
        &result,
        &allowed,
        task.playback_cutoff_ms,
        &required_chunk_ids,
        false,
        task.analysis_mode,
    )?;
    SummaryResultRepository::new(store).save_summary(&task.id, &result, false)?;
    repository.get(&task.id)
}

#[cfg(test)]
#[path = "executor_tests.rs"]
mod tests;
