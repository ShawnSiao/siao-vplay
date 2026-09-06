use crate::{
    agent_task_files::hash_bytes,
    store::ProjectStore,
    translation::{self, TranslationError},
    verified_task_files,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentScope {
    id: String,
    start_ms: i64,
    end_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationDispatchPreview {
    task_id: String,
    confirmation_sha256: String,
    handoff_kind: String,
    receiver: String,
    model: String,
    source_version_id: String,
    source_version_number: i64,
    source_language_code: String,
    target_language_code: String,
    scope: String,
    segments: Vec<SegmentScope>,
    context: Value,
    glossary: Value,
}

pub(crate) fn read(
    store: &ProjectStore,
    task_id: &str,
    relative: &str,
) -> Result<Vec<u8>, TranslationError> {
    let directory = translation::task_directory(store, task_id)?;
    let hash: String = store.connect()?.query_row(
        "SELECT material_manifest_sha256 FROM agent_tasks WHERE id = ?1",
        [task_id],
        |row| row.get(0),
    )?;
    verified_task_files::read(&directory, &hash, relative).map_err(Into::into)
}

pub(crate) fn read_json<T: for<'de> Deserialize<'de>>(
    store: &ProjectStore,
    task_id: &str,
    relative: &str,
) -> Result<T, TranslationError> {
    Ok(serde_json::from_slice(&read(store, task_id, relative)?)?)
}

pub(crate) fn preview(
    store: &ProjectStore,
    task_id: &str,
) -> Result<TranslationDispatchPreview, TranslationError> {
    let task = translation::get_translation_task(store, task_id)?;
    let consistent: bool = store.connect()?.query_row(
        "SELECT execution_kind = handoff_kind OR (execution_kind = 'api' AND handoff_kind = 'manual') FROM agent_tasks WHERE id = ?1",
        [task_id], |row| row.get(0))?;
    if !consistent { return Err(TranslationError::TaskIntegrity("执行方式与交接记录不一致，请重新准备翻译".into())); }
    translation::verify_task_package(
        store,
        task_id,
        &translation::task_directory(store, task_id)?,
    )?;
    let segments: Vec<SegmentScope> = read_json(store, task_id, "input/segments.json")?;
    let ids = segments
        .iter()
        .map(|item| item.id.as_str())
        .collect::<BTreeSet<_>>();
    if segments.len() != task.segment_count
        || ids.len() != segments.len()
        || ids
            != task
                .authorized_segment_ids
                .iter()
                .map(String::as_str)
                .collect()
        || segments
            .iter()
            .any(|item| item.start_ms < 0 || item.end_ms < item.start_ms)
    {
        return Err(TranslationError::TaskIntegrity(
            "实际选段与任务授权不一致".into(),
        ));
    }
    let (version, total): (i64, i64) = store.connect()?.query_row(
        "SELECT version_number, (SELECT COUNT(*) FROM subtitle_segments WHERE version_id = v.id)
         FROM subtitle_versions v WHERE id = ?1 AND project_id = ?2",
        rusqlite::params![task.source_version_id, task.project_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let api = if task.handoff_kind == "api" {
        Some(crate::ai::translation_api::receiver(store, task_id).map_err(|error| TranslationError::TaskIntegrity(error.to_string()))?)
    } else { None };
    let receiver = match task.handoff_kind.as_str() {
        "codex" => "OpenAI（通过本机 Codex 登录，需要联网）",
        "manual" => "自行选择的外部工具（本应用不自动发送）",
        "api" => &api.as_ref().expect("API receiver was resolved").base_url,
        _ => return Err(TranslationError::InvalidHandoff(task.handoff_kind.clone())),
    };
    let prompt = read(store, task_id, "prompt.md")?;
    let schema = read(store, task_id, "result.schema.json")?;
    let mut value = TranslationDispatchPreview {
        task_id: task_id.into(),
        confirmation_sha256: String::new(),
        handoff_kind: task.handoff_kind.clone(),
        receiver: receiver.into(),
        model: if let Some(api) = &api { api.model_id.as_str() } else if task.handoff_kind == "codex" {
            "Codex 默认模型"
        } else {
            "由所选工具决定"
        }
        .into(),
        source_version_id: task.source_version_id.clone(),
        source_version_number: version,
        source_language_code: task.source_language_code.clone(),
        target_language_code: task.target_language_code.clone(),
        scope: if total == segments.len() as i64 {
            "full_subtitles"
        } else {
            "selected_subtitles"
        }
        .into(),
        segments,
        context: read_json(store, task_id, "input/context.json")?,
        glossary: read_json(store, task_id, "input/glossary.json")?,
    };
    value.confirmation_sha256 = hash_bytes(&serde_json::to_vec(&serde_json::json!({
        "protocol": "siaovplay-translation-dispatch-v1", "preview": &value, "task": task,
        "promptSha256": hash_bytes(&prompt), "schemaSha256": hash_bytes(&schema),
        "apiReceiver": api,
        "apiPolicy": if task.handoff_kind == "api" { crate::ai::translation_api::confirmation_policy().map_err(|error| TranslationError::TaskIntegrity(error.to_string()))? } else { Value::Null },
    }))?);
    Ok(value)
}

pub(crate) fn verify(
    store: &ProjectStore,
    task_id: &str,
    hash: &str,
) -> Result<(), TranslationError> {
    verify_kind(store, task_id, hash, "codex")
}

pub(crate) fn verify_api(store: &ProjectStore, task_id: &str, hash: &str) -> Result<(), TranslationError> {
    verify_kind(store, task_id, hash, "api")
}

fn verify_kind(store: &ProjectStore, task_id: &str, hash: &str, kind: &str) -> Result<(), TranslationError> {
    let value = preview(store, task_id)?;
    if value.handoff_kind != kind || hash.len() != 64 || value.confirmation_sha256 != hash {
        return Err(TranslationError::TaskIntegrity(
            "接收方或材料已改变，请重新确认翻译清单".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_translation_dispatch(
    store: tauri::State<'_, ProjectStore>,
    input: translation::TranslationTaskInput,
) -> Result<TranslationDispatchPreview, crate::commands::CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        preview(&store, &input.task_id).map_err(Into::into)
    })
    .await
    .map_err(crate::commands::CommandError::background_task_failed)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::translation::fixture::TranslationFixture;

    #[test]
    fn confirmation_binds_actual_translation_materials_receiver_and_version() {
        let fixture = TranslationFixture::new();
        let task = translation::prepare_translation_task(
            &fixture.store,
            crate::translation_test_support::translation_input(
                fixture.project_id.clone(),
                "codex",
                "ja",
            ),
        )
        .unwrap();
        let value = preview(&fixture.store, &task.id).unwrap();
        assert_eq!(value.scope, "full_subtitles");
        assert_eq!(value.segments.len(), 2);
        assert_eq!(value.segments[1].end_ms, 2600);
        assert_eq!(value.source_version_id, fixture.source_version_id);
        assert!(value.receiver.contains("OpenAI"));
        verify(&fixture.store, &task.id, &value.confirmation_sha256).unwrap();
        assert!(verify(&fixture.store, &task.id, "").is_err());
        fixture
            .store
            .connect()
            .unwrap()
            .execute(
                "UPDATE agent_tasks SET handoff_kind = 'manual' WHERE id = ?1",
                [&task.id],
            )
            .unwrap();
        assert!(verify(&fixture.store, &task.id, &value.confirmation_sha256).is_err());
    }

    #[test]
    fn changed_translation_material_cannot_be_sent_with_an_earlier_confirmation() {
        let fixture = TranslationFixture::new();
        let task = translation::prepare_translation_task(
            &fixture.store,
            crate::translation_test_support::translation_input(
                fixture.project_id.clone(),
                "codex",
                "ja",
            ),
        )
        .unwrap();
        let value = preview(&fixture.store, &task.id).unwrap();
        let bytes = read(&fixture.store, &task.id, "input/segments.json").unwrap();
        std::fs::write(
            translation::task_directory(&fixture.store, &task.id)
                .unwrap()
                .join("input/segments.json"),
            b"[]",
        )
        .unwrap();
        assert!(bytes.len() > 2);
        assert!(read(&fixture.store, &task.id, "input/segments.json").is_err());
        assert!(verify(&fixture.store, &task.id, &value.confirmation_sha256).is_err());
    }
}
