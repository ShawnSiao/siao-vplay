use base64::{Engine as _, engine::general_purpose::STANDARD};

use super::{
    connection,
    providers::{self, GenerationInput, ProviderFailure, ProviderOutput},
    request_coordinator::global_request_coordinator,
    task_persistence::{self, AiTaskKind},
    task_types::{
        AiTaskError, ResumeAiTaskInput, StartExplanationTaskInput, StartLearningTaskInput,
    },
    types::{AiExecutionTarget, AiMaterialAuthorization, ResolvedAiService},
};
use crate::{
    codex_runner::{self, StartCodexTranslationInput},
    learning::{self, LearningTask, PrepareLearningTaskInput},
    store::ProjectStore,
    understanding::{self, ExplanationTask, PrepareExplanationTaskInput},
};

pub fn start_explanation(
    store: &ProjectStore,
    input: StartExplanationTaskInput,
) -> Result<ExplanationTask, AiTaskError> {
    validate_authorization(&input.authorization)?;
    let service = api_service(&input.execution, &input.authorization)?;
    let task = understanding::prepare_explanation_task(
        store,
        PrepareExplanationTaskInput {
            project_id: input.project_id,
            handoff_kind: input.execution.kind().to_owned(),
            playback_cutoff_ms: input.playback_cutoff_ms,
        },
    )?;
    match input.execution {
        AiExecutionTarget::Manual => Ok(task),
        AiExecutionTarget::Codex => run_codex_explanation(store, &task.id, false),
        AiExecutionTarget::Api { .. } => run_api_explanation(
            store,
            &task.id,
            required_service(service)?,
            input.authorization,
            false,
        ),
    }
}

pub fn resume_explanation(
    store: &ProjectStore,
    input: ResumeAiTaskInput,
) -> Result<ExplanationTask, AiTaskError> {
    validate_authorization(&input.authorization)?;
    match &input.execution {
        AiExecutionTarget::Api { .. } => run_api_explanation(
            store,
            &input.task_id,
            connection::resolve_execution(&input.execution, input.authorization.service_revision)?,
            input.authorization,
            true,
        ),
        AiExecutionTarget::Manual => {
            task_persistence::switch_local(
                store,
                AiTaskKind::Explanation,
                &input.task_id,
                &input.execution,
            )?;
            Ok(understanding::get_explanation_task(store, &input.task_id)?)
        }
        AiExecutionTarget::Codex => {
            task_persistence::switch_local(
                store,
                AiTaskKind::Explanation,
                &input.task_id,
                &input.execution,
            )?;
            run_codex_explanation(store, &input.task_id, true)
        }
    }
}

pub fn start_learning(
    store: &ProjectStore,
    input: StartLearningTaskInput,
) -> Result<LearningTask, AiTaskError> {
    validate_authorization(&input.authorization)?;
    let service = api_service(&input.execution, &input.authorization)?;
    let task = learning::prepare_learning_task(
        store,
        PrepareLearningTaskInput {
            project_id: input.project_id,
            handoff_kind: input.execution.kind().to_owned(),
            source_segment_id: input.source_segment_id,
            selected_text: input.selected_text,
            selection_kind: input.selection_kind,
            playback_position_ms: input.playback_position_ms,
        },
    )?;
    match input.execution {
        AiExecutionTarget::Manual => Ok(task),
        AiExecutionTarget::Codex => run_codex_learning(store, &task.id, false),
        AiExecutionTarget::Api { .. } => run_api_learning(
            store,
            &task.id,
            required_service(service)?,
            input.authorization,
            false,
        ),
    }
}

pub fn resume_learning(
    store: &ProjectStore,
    input: ResumeAiTaskInput,
) -> Result<LearningTask, AiTaskError> {
    validate_authorization(&input.authorization)?;
    match &input.execution {
        AiExecutionTarget::Api { .. } => run_api_learning(
            store,
            &input.task_id,
            connection::resolve_execution(&input.execution, input.authorization.service_revision)?,
            input.authorization,
            true,
        ),
        AiExecutionTarget::Manual => {
            task_persistence::switch_local(
                store,
                AiTaskKind::Learning,
                &input.task_id,
                &input.execution,
            )?;
            Ok(learning::get_learning_task(store, &input.task_id)?)
        }
        AiExecutionTarget::Codex => {
            task_persistence::switch_local(
                store,
                AiTaskKind::Learning,
                &input.task_id,
                &input.execution,
            )?;
            run_codex_learning(store, &input.task_id, true)
        }
    }
}

fn run_api_explanation(
    store: &ProjectStore,
    task_id: &str,
    service: ResolvedAiService,
    authorization: AiMaterialAuthorization,
    resume: bool,
) -> Result<ExplanationTask, AiTaskError> {
    let revision = authorization.service_revision.unwrap_or_default();
    task_persistence::claim_api(
        store,
        AiTaskKind::Explanation,
        task_id,
        &service,
        revision,
        resume,
    )?;
    let task = understanding::get_explanation_task(store, task_id)?;
    let model_id = selected_model(&service)?;
    let frames_effective =
        authorization.frames && providers::model_supports_vision(&service, model_id);
    let prompt = authorized_explanation_prompt(
        understanding::read_explanation_prompt(store, task_id)?,
        frames_effective,
    );
    let images = if frames_effective {
        encode_frames(&task)?
    } else {
        Vec::new()
    };
    let schema = understanding::read_explanation_schema(store, task_id)?;
    let output = execute_provider(
        store,
        AiTaskKind::Explanation,
        task_id,
        &service,
        GenerationInput {
            model_id: model_id.to_owned(),
            system: "只依据已授权的当前播放点及之前材料进行无剧透场景解释。".to_owned(),
            prompt,
            schema_name: "scene_explanation".to_owned(),
            schema,
            image_data_urls: images,
        },
    )?;
    match understanding::apply_api_result(store, task_id, &output.output_text) {
        Ok(application) => Ok(application.task),
        Err(error) => {
            task_persistence::fail(
                store,
                AiTaskKind::Explanation,
                task_id,
                error.code(),
                &error.to_string(),
                output.provider_request_id.as_deref(),
            );
            Err(error.into())
        }
    }
}

fn run_api_learning(
    store: &ProjectStore,
    task_id: &str,
    service: ResolvedAiService,
    authorization: AiMaterialAuthorization,
    resume: bool,
) -> Result<LearningTask, AiTaskError> {
    task_persistence::claim_api(
        store,
        AiTaskKind::Learning,
        task_id,
        &service,
        authorization.service_revision.unwrap_or_default(),
        resume,
    )?;
    let model_id = selected_model(&service)?;
    let output = execute_provider(
        store,
        AiTaskKind::Learning,
        task_id,
        &service,
        GenerationInput {
            model_id: model_id.to_owned(),
            system: "只依据用户选择的当前字幕文本提供学习辅助，不补充后续剧情。".to_owned(),
            prompt: learning::read_learning_prompt(store, task_id)?,
            schema_name: "contextual_learning".to_owned(),
            schema: learning::read_learning_schema(store, task_id)?,
            image_data_urls: Vec::new(),
        },
    )?;
    match learning::apply_api_result(store, task_id, &output.output_text) {
        Ok(application) => Ok(application.task),
        Err(error) => {
            task_persistence::fail(
                store,
                AiTaskKind::Learning,
                task_id,
                error.code(),
                &error.to_string(),
                output.provider_request_id.as_deref(),
            );
            Err(error.into())
        }
    }
}

fn execute_provider(
    store: &ProjectStore,
    kind: AiTaskKind,
    task_id: &str,
    service: &ResolvedAiService,
    input: GenerationInput,
) -> Result<ProviderOutput, AiTaskError> {
    let lane = service
        .service_config_id
        .as_deref()
        .unwrap_or(&service.base_url);
    let _request_permit = global_request_coordinator().acquire_interactive(lane);
    let output = providers::generate(service, &input).map_err(|failure| {
        fail_provider(store, kind, task_id, &failure);
        AiTaskError::from(failure)
    })?;
    task_persistence::record_provider_output(
        store,
        kind,
        task_id,
        output.provider_request_id.as_deref(),
        output.usage.as_ref(),
    )?;
    Ok(output)
}

fn fail_provider(store: &ProjectStore, kind: AiTaskKind, task_id: &str, failure: &ProviderFailure) {
    task_persistence::fail(
        store,
        kind,
        task_id,
        failure.error.code(),
        &failure.error.to_string(),
        failure.provider_request_id.as_deref(),
    );
}

fn api_service(
    execution: &AiExecutionTarget,
    authorization: &AiMaterialAuthorization,
) -> Result<Option<ResolvedAiService>, AiTaskError> {
    match execution {
        AiExecutionTarget::Api { .. } => Ok(Some(connection::resolve_execution(
            execution,
            authorization.service_revision,
        )?)),
        _ => Ok(None),
    }
}

fn required_service(service: Option<ResolvedAiService>) -> Result<ResolvedAiService, AiTaskError> {
    service
        .ok_or_else(|| super::error::AiError::Validation("AI 服务配置未能解析".to_owned()).into())
}

fn selected_model(service: &ResolvedAiService) -> Result<&str, AiTaskError> {
    service
        .model_id
        .as_deref()
        .ok_or_else(|| super::error::AiError::Validation("请选择或填写模型".to_owned()).into())
}

fn validate_authorization(authorization: &AiMaterialAuthorization) -> Result<(), AiTaskError> {
    if authorization.subtitles && authorization.current_question {
        Ok(())
    } else {
        Err(super::error::AiError::Validation(
            "必须确认向所选服务发送当前字幕与当前问题".to_owned(),
        )
        .into())
    }
}

fn authorized_explanation_prompt(prompt: String, include_frames: bool) -> String {
    if include_frames {
        return prompt;
    }
    let Some(start) = prompt.find("## 已授权关键帧") else {
        return prompt;
    };
    let Some(relative_end) = prompt[start..].find("## 结果校验规则") else {
        return prompt;
    };
    let end = start + relative_end;
    format!(
        "{}## 已授权关键帧\n\n本次未授权发送画面。\n\n{}",
        &prompt[..start],
        &prompt[end..]
    )
}

fn encode_frames(task: &ExplanationTask) -> Result<Vec<String>, AiTaskError> {
    task.frames
        .iter()
        .map(|frame| {
            let data = std::fs::read(&frame.path)?;
            Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(data)))
        })
        .collect()
}

fn run_codex_explanation(
    store: &ProjectStore,
    task_id: &str,
    resume: bool,
) -> Result<ExplanationTask, AiTaskError> {
    let input = StartCodexTranslationInput {
        task_id: task_id.to_owned(),
        timeout_seconds: None,
    };
    if resume {
        Ok(codex_runner::resume_codex_explanation_task(store, input)?)
    } else {
        Ok(codex_runner::start_codex_explanation_task(store, input)?)
    }
}

fn run_codex_learning(
    store: &ProjectStore,
    task_id: &str,
    resume: bool,
) -> Result<LearningTask, AiTaskError> {
    let input = StartCodexTranslationInput {
        task_id: task_id.to_owned(),
        timeout_seconds: None,
    };
    if resume {
        Ok(codex_runner::resume_codex_learning_task(store, input)?)
    } else {
        Ok(codex_runner::start_codex_learning_task(store, input)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_only_prompt_removes_frame_manifest() {
        let prompt = "before\n## 已授权关键帧\n\n```json\n[path]\n```\n\n## 结果校验规则\nafter";
        let redacted = authorized_explanation_prompt(prompt.to_owned(), false);
        assert!(!redacted.contains("[path]"));
        assert!(redacted.contains("本次未授权发送画面"));
        assert!(redacted.contains("## 结果校验规则"));
    }
}
