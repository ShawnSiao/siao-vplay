use super::super::{AiError, task_types::AiTaskError};
use crate::{store::ProjectStore, translation, translation_dispatch};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Segment {
    pub id: String,
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receiver {
    pub service_config_id: String,
    pub service_revision: u64,
    pub model_id: String,
    pub base_url: String,
}

pub(super) struct Batch {
    pub id: String,
    pub segment_ids: Vec<String>,
    pub result: Option<String>,
}

pub(crate) fn receiver(store: &ProjectStore, id: &str) -> Result<Receiver, AiTaskError> {
    let (service_config_id, revision, model_id): (String, i64, String) = store.connect()?.query_row(
        "SELECT service_config_id, service_revision, model_id FROM agent_tasks WHERE id = ?1 AND execution_kind = 'api'", [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
    let revision = u64::try_from(revision).map_err(|_| AiError::RevisionConflict)?;
    let service = super::super::summary_provider::receiver(&service_config_id, revision)?;
    Ok(Receiver {
        service_config_id,
        service_revision: revision,
        model_id,
        base_url: service.base_url,
    })
}

pub(super) fn segments(store: &ProjectStore, id: &str) -> Result<Vec<Segment>, AiTaskError> {
    Ok(translation_dispatch::read_json(
        store,
        id,
        "input/segments.json",
    )?)
}

pub(super) fn prepare_batches(
    store: &ProjectStore,
    id: &str,
    policy: &super::policy::Policy,
) -> Result<(), AiTaskError> {
    let segments = segments(store, id)?;
    let mut groups: Vec<Vec<String>> = Vec::new();
    let mut current = Vec::new();
    let mut characters = 0;
    for segment in segments {
        let length = segment.text.chars().count();
        if length > policy.max_source_characters_per_batch {
            return Err(AiError::Validation("单条字幕过长，请先拆分再翻译".into()).into());
        }
        if !current.is_empty()
            && (current.len() >= policy.max_segments_per_batch
                || characters + length > policy.max_source_characters_per_batch)
        {
            groups.push(std::mem::take(&mut current));
            characters = 0;
        }
        current.push(segment.id);
        characters += length;
    }
    if !current.is_empty() {
        groups.push(current);
    }
    let mut connection = store.connect()?;
    let tx = connection.transaction()?;
    let queued: bool = tx.query_row(
        "SELECT status = 'queued' AND execution_kind = 'api' FROM agent_tasks WHERE id = ?1",
        [id],
        |row| row.get(0),
    )?;
    if !queued {
        return Err(AiError::Validation("翻译已开始，不能重新划分批次".into()).into());
    }
    tx.execute("DELETE FROM agent_task_batches WHERE task_id = ?1", [id])?;
    let timestamp = super::super::task_persistence::now_ms()?;
    for (ordinal, ids) in groups.iter().enumerate() {
        tx.execute("INSERT INTO agent_task_batches(id, task_id, ordinal, status, segment_ids_json, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, 'prepared', ?4, ?5, ?5)",
            params![uuid::Uuid::new_v4().to_string(), id, ordinal as i64, serde_json::to_string(ids)?, timestamp])?;
    }
    tx.commit()?;
    Ok(())
}

pub(super) fn batches(store: &ProjectStore, id: &str) -> Result<Vec<Batch>, AiTaskError> {
    let connection = store.connect()?;
    let mut statement = connection.prepare("SELECT id, segment_ids_json, CASE WHEN status = 'completed' THEN result_json ELSE NULL END FROM agent_task_batches WHERE task_id = ?1 ORDER BY ordinal")?;
    let rows = statement.query_map([id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    rows.map(|row| {
        let (id, ids, result) = row?;
        Ok(Batch {
            id,
            segment_ids: serde_json::from_str(&ids)?,
            result,
        })
    })
    .collect()
}

pub(super) fn save_batch(
    store: &ProjectStore,
    task: &str,
    batch: &str,
    result: &Value,
    progress: f64,
) -> Result<(), AiTaskError> {
    let mut connection = store.connect()?;
    let tx = connection.transaction()?;
    let timestamp = super::super::task_persistence::now_ms()?;
    let changed = tx.execute("UPDATE agent_tasks SET progress = ?2, stage = 'translating_batches', updated_at_ms = ?3 WHERE id = ?1 AND status = 'running' AND cancel_requested_at_ms IS NULL", params![task, progress, timestamp])?;
    if changed != 1 {
        return Err(AiError::Cancelled.into());
    }
    let saved = tx.execute("UPDATE agent_task_batches SET status = 'completed', result_json = ?3, error_code = NULL, error_message = NULL, completed_at_ms = ?4, updated_at_ms = ?4 WHERE id = ?1 AND task_id = ?2", params![batch, task, serde_json::to_string(result)?, timestamp])?;
    if saved != 1 {
        return Err(invalid("翻译批次已改变"));
    }
    tx.commit()?;
    Ok(())
}

pub(crate) fn recover(store: &ProjectStore) -> Result<usize, crate::store::StoreError> {
    Ok(store.connect()?.execute("UPDATE agent_tasks SET status = CASE WHEN cancel_requested_at_ms IS NULL THEN 'interrupted' ELSE 'cancelled' END, stage = CASE WHEN cancel_requested_at_ms IS NULL THEN 'interrupted' ELSE 'cancelled' END, error_code = CASE WHEN cancel_requested_at_ms IS NULL THEN 'app_interrupted' ELSE NULL END, error_message = CASE WHEN cancel_requested_at_ms IS NULL THEN '翻译被中断，可重试未完成批次' ELSE NULL END WHERE execution_kind = 'api' AND status IN ('running', 'validating')", [])?)
}

pub(super) fn invalid(message: &str) -> AiTaskError {
    translation::TranslationError::InvalidResult(message.into()).into()
}
