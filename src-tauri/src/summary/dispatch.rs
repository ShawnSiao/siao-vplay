use super::{
    keyframes::SummaryFrame,
    model::{AnalysisScope, SummaryExecutionKind},
    task_repository::SummaryTaskRepository,
    verified_materials,
};
use crate::{
    ai::summary_provider,
    store::{ProjectStore, StoreError},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedSummaryInput {
    pub task_id: String,
    pub confirmation_sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct SummaryDispatchPreview {
    pub task_id: String,
    pub confirmation_sha256: String,
    pub execution_kind: SummaryExecutionKind,
    pub receiver: String,
    pub endpoint: Option<String>,
    pub model: String,
    pub scope: AnalysisScope,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub playback_cutoff_ms: Option<i64>,
    pub subtitle_version_id: String,
    #[cfg_attr(test, schemars(range(min = 1, max = 9007199254740991_u64)))]
    pub subtitle_version_number: i64,
    pub subtitle_role: String,
    pub subtitle_language: String,
    #[cfg_attr(test, schemars(range(min = 1, max = 9007199254740991_u64)))]
    pub segment_count: usize,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub first_start_ms: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub last_end_ms: Option<i64>,
    pub prompt_template: String,
    pub one_time_requirements: String,
    pub frames: Vec<SummaryFrame>,
}

#[cfg(test)]
pub(crate) fn dispatch_contract_example() -> serde_json::Value {
    serde_json::to_value(SummaryDispatchPreview {
        task_id: "summary-task-1".into(), confirmation_sha256: "a".repeat(64),
        execution_kind: SummaryExecutionKind::Codex, receiver: "OpenAI（经本机 Codex）".into(), endpoint: None,
        model: "Codex 默认模型".into(), scope: AnalysisScope::CurrentProgress, playback_cutoff_ms: Some(15000),
        subtitle_version_id: "subtitle-1".into(), subtitle_version_number: 3, subtitle_role: "original".into(),
        subtitle_language: "en".into(), segment_count: 12, first_start_ms: Some(0), last_end_ms: Some(16000),
        prompt_template: "自动判断".into(), one_time_requirements: "".into(),
        frames: vec![SummaryFrame { id: "frame".into(), ordinal: 0, timestamp_ms: 1000,
            relative_path: "input/frames/frame.jpg".into(), sha256: "b".repeat(64) }],
    }).unwrap()
}

pub(crate) fn preview(
    store: &ProjectStore,
    task_id: &str,
) -> Result<SummaryDispatchPreview, StoreError> {
    let task = SummaryTaskRepository::new(store).get(task_id)?;
    let materials = verified_materials::load(store, &task)?;
    let (receiver, endpoint, model) = match task.execution_kind {
        SummaryExecutionKind::Manual => (
            "自行选择的工具".to_owned(),
            None,
            "由所选工具决定".to_owned(),
        ),
        SummaryExecutionKind::Codex => (
            "OpenAI（经本机 Codex）".to_owned(),
            None,
            "Codex 默认模型".to_owned(),
        ),
        SummaryExecutionKind::Api => {
            let id = task
                .service_config_id
                .as_deref()
                .ok_or_else(|| invalid("任务缺少接收服务，请重新准备"))?;
            let revision = task
                .service_revision
                .ok_or_else(|| invalid("任务缺少服务版本，请重新准备"))?;
            let service = summary_provider::receiver(id, revision)
                .map_err(|_| invalid("接收服务已改变或不可用，请重新选择服务并准备材料"))?;
            let model = task
                .model_id
                .clone()
                .filter(|model| !model.trim().is_empty())
                .ok_or_else(|| invalid("任务缺少模型，请重新准备"))?;
            (service.display_name, Some(service.base_url), model)
        }
    };
    let (number, role, language) = store.connect()?.query_row(
        "SELECT v.version_number, t.role, v.language_code FROM subtitle_versions v
         JOIN subtitle_tracks t ON t.id = v.track_id WHERE v.id = ?1 AND v.project_id = ?2",
        rusqlite::params![task.subtitle_version_id, task.project_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let mut preview = SummaryDispatchPreview {
        task_id: task.id.clone(),
        confirmation_sha256: String::new(),
        execution_kind: task.execution_kind,
        receiver,
        endpoint,
        model,
        scope: task.scope,
        playback_cutoff_ms: task.playback_cutoff_ms,
        subtitle_version_id: task.subtitle_version_id.clone(),
        subtitle_version_number: number,
        subtitle_role: role,
        subtitle_language: language,
        segment_count: materials.segments.len(),
        first_start_ms: materials
            .segments
            .iter()
            .map(|segment| segment.start_ms)
            .min(),
        last_end_ms: materials
            .segments
            .iter()
            .map(|segment| segment.end_ms)
            .max(),
        prompt_template: task.prompt_snapshot.template_name.clone(),
        one_time_requirements: task.prompt_snapshot.one_time_requirements.clone(),
        frames: materials
            .frames
            .into_iter()
            .map(|frame| frame.metadata)
            .collect(),
    };
    let canonical = serde_json::to_vec(&serde_json::json!({
        "protocol": "siaovplay-summary-dispatch-v1", "preview": &preview,
        "projectId": task.project_id, "materialSha256": task.material_manifest_sha256,
        "prompt": task.prompt_snapshot, "serviceId": task.service_config_id,
        "serviceRevision": task.service_revision, "analysisMode": task.analysis_mode,
    }))
    .map_err(|_| invalid("无法确认总结材料"))?;
    preview.confirmation_sha256 = format!("{:x}", Sha256::digest(canonical));
    Ok(preview)
}

pub(crate) fn verify(
    store: &ProjectStore,
    input: &ConfirmedSummaryInput,
) -> Result<(), StoreError> {
    if input.confirmation_sha256.len() != 64
        || preview(store, &input.task_id)?.confirmation_sha256 != input.confirmation_sha256
    {
        return Err(invalid("接收方或材料已经改变，请重新查看并确认发送清单"));
    }
    Ok(())
}
fn invalid(message: &str) -> StoreError {
    StoreError::Validation(message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::test_support::prepared_summary;

    #[test]
    fn confirmation_binds_actual_subtitle_scope_and_task_identity() {
        let (_directory, store, task) = prepared_summary();
        let preview = preview(&store, &task.id).unwrap();
        assert_eq!(preview.segment_count, 1);
        assert_eq!(preview.subtitle_version_number, 1);
        assert_eq!(preview.playback_cutoff_ms, Some(1_000));
        assert!(preview.frames.is_empty());
        let mut input = ConfirmedSummaryInput {
            task_id: task.id.clone(),
            confirmation_sha256: preview.confirmation_sha256,
        };
        verify(&store, &input).unwrap();
        input.confirmation_sha256 = "0".repeat(64);
        assert!(verify(&store, &input).is_err());
    }

    #[test]
    fn changing_the_recipient_invalidates_confirmation() {
        let (_directory, store, task) = prepared_summary();
        let input = ConfirmedSummaryInput {
            task_id: task.id.clone(),
            confirmation_sha256: preview(&store, &task.id).unwrap().confirmation_sha256,
        };
        store
            .connect()
            .unwrap()
            .execute(
                "UPDATE summary_tasks SET execution_kind = 'codex' WHERE id = ?1",
                [&task.id],
            )
            .unwrap();
        assert!(verify(&store, &input).is_err());
    }
}
