use super::super::{
    AiError, connection,
    providers::{self, GenerationInput},
    request_coordinator::global_request_coordinator,
    task_cancellation,
    task_types::AiTaskError,
    types::AiExecutionTarget,
};
use super::{
    policy,
    repository::{self, Receiver, Segment},
};
use crate::{
    agent_result,
    store::ProjectStore,
    translation::{self, TranslationTask},
    translation_dispatch,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeSet, time::Duration};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultEnvelope {
    protocol_version: String,
    task_id: String,
    source_version_id: String,
    target_language_code: String,
    translations: Vec<Item>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Item {
    segment_id: String,
    translated_text: String,
}

pub(super) fn run(store: &ProjectStore, id: &str, receiver: &Receiver) -> Result<(), AiTaskError> {
    let policy = policy::load()?;
    let cancelled = task_cancellation::for_task(store, id);
    run_with(store, id, |prompt, schema| {
        let _permit = global_request_coordinator()
            .acquire_summary_cancellable(&receiver.service_config_id, || cancelled())?
            .ok_or(AiError::Cancelled)?;
        let service = connection::resolve_execution(
            &AiExecutionTarget::Api {
                service_config_id: receiver.service_config_id.clone(),
                model_id: receiver.model_id.clone(),
            },
            Some(receiver.service_revision),
        )?;
        let output = providers::generate(
            &service,
            &GenerationInput {
                model_id: receiver.model_id.clone(),
                system: policy.system.clone(),
                prompt: serde_json::to_string(prompt)?,
                schema_name: "subtitle_translation_batch".into(),
                schema: schema.clone(),
                image_data_urls: vec![],
                max_output_tokens: policy.max_output_tokens,
                timeout: Duration::from_secs(policy.timeout_seconds),
                cancellation: Some(cancelled.clone()),
            },
        )?;
        Ok(output.output_text)
    })
}

pub(super) fn run_with(
    store: &ProjectStore,
    id: &str,
    mut generate: impl FnMut(&Value, &Value) -> Result<String, AiTaskError>,
) -> Result<(), AiTaskError> {
    let task = translation::get_translation_task(store, id)?;
    let segments = repository::segments(store, id)?;
    let batches = repository::batches(store, id)?;
    let all_ids = batches
        .iter()
        .flat_map(|batch| batch.segment_ids.iter())
        .collect::<Vec<_>>();
    if all_ids
        != segments
            .iter()
            .map(|segment| &segment.id)
            .collect::<Vec<_>>()
        || all_ids.len() != task.segment_count
    {
        return Err(repository::invalid("翻译批次没有完整覆盖已授权字幕"));
    }
    let context: Value = translation_dispatch::read_json(store, id, "input/context.json")?;
    let glossary: Value = translation_dispatch::read_json(store, id, "input/glossary.json")?;
    let cancelled = task_cancellation::for_task(store, id);
    let mut accepted = Vec::new();
    for (position, batch) in batches.iter().enumerate() {
        if cancelled()? {
            return Err(AiError::Cancelled.into());
        }
        let raw = match &batch.result {
            Some(result) => result.clone(),
            None => {
                let selected = segments
                    .iter()
                    .filter(|segment| batch.segment_ids.contains(&segment.id))
                    .collect::<Vec<&Segment>>();
                let prompt = json!({"protocolVersion": task.protocol_version, "taskId": id,
                    "sourceVersionId": task.source_version_id, "sourceLanguageCode": task.source_language_code,
                    "targetLanguageCode": task.target_language_code, "segments": selected,
                    "context": context, "glossary": glossary});
                generate(&prompt, &schema(&task, &batch.segment_ids))?
            }
        };
        let result = validate(&task, &batch.segment_ids, &raw)?;
        repository::save_batch(
            store,
            id,
            &batch.id,
            &serde_json::to_value(&result)?,
            (position + 1) as f64 / batches.len() as f64 * 0.9,
        )?;
        accepted.extend(result.translations);
    }
    if cancelled()? {
        return Err(AiError::Cancelled.into());
    }
    let result = ResultEnvelope {
        protocol_version: task.protocol_version,
        task_id: id.into(),
        source_version_id: task.source_version_id,
        target_language_code: task.target_language_code,
        translations: accepted,
    };
    translation::apply_api_result(store, id, &serde_json::to_string(&result)?)?;
    Ok(())
}

fn validate(
    task: &TranslationTask,
    ids: &[String],
    raw: &str,
) -> Result<ResultEnvelope, AiTaskError> {
    let normalized = agent_result::normalize_external_result(raw)
        .map_err(|message| repository::invalid(&message))?;
    let result: ResultEnvelope = serde_json::from_str(&normalized)
        .map_err(|error| repository::invalid(&format!("翻译批次 JSON 无效：{error}")))?;
    if result.protocol_version != task.protocol_version
        || result.task_id != task.id
        || result.source_version_id != task.source_version_id
        || result.target_language_code != task.target_language_code
    {
        return Err(repository::invalid("翻译批次的任务、版本或目标语言不匹配"));
    }
    let returned = result
        .translations
        .iter()
        .map(|item| &item.segment_id)
        .collect::<BTreeSet<_>>();
    if result.translations.len() != ids.len()
        || returned.len() != ids.len()
        || returned != ids.iter().collect()
    {
        return Err(repository::invalid("翻译批次缺行、重复或包含未授权字幕"));
    }
    if result.translations.iter().any(|item| {
        item.translated_text.trim().is_empty()
            || item.translated_text.chars().count() > 4000
            || item
                .translated_text
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    }) {
        return Err(repository::invalid(
            "翻译批次包含空文本、超长文本或非法控制字符",
        ));
    }
    Ok(result)
}

fn schema(task: &TranslationTask, ids: &[String]) -> Value {
    json!({"type": "object", "additionalProperties": false,
    "required": ["protocolVersion", "taskId", "sourceVersionId", "targetLanguageCode", "translations"],
    "properties": {
        "protocolVersion": {"type": "string", "enum": [task.protocol_version]},
        "taskId": {"type": "string", "enum": [task.id]},
        "sourceVersionId": {"type": "string", "enum": [task.source_version_id]},
        "targetLanguageCode": {"type": "string", "enum": [task.target_language_code]},
        "translations": {"type": "array", "minItems": ids.len(), "maxItems": ids.len(), "items": {
            "type": "object", "additionalProperties": false, "required": ["segmentId", "translatedText"],
            "properties": {"segmentId": {"type": "string", "enum": ids}, "translatedText": {"type": "string", "minLength": 1, "maxLength": 4000}}
        }}
    }})
}
