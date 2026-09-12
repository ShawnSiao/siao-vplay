use std::{thread, time::{Duration, Instant}};
use serde::Deserialize;
use super::CommandError;
use crate::{domain::DeleteProjectResult, store::ProjectStore, storage::StorageManager};
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Policy { timeout_ms: u64, poll_ms: u64 }
fn parse(source: &str) -> Result<Policy, CommandError> {
    let invalid = || CommandError { code: "project_delete_policy_invalid", message: "项目删除等待配置无效".into() };
    let policy: Policy = serde_json::from_str(source).map_err(|_| invalid())?;
    if !(1..=120_000).contains(&policy.timeout_ms) || policy.poll_ms == 0 || policy.poll_ms > policy.timeout_ms { return Err(invalid()); }
    Ok(policy)
}
pub(super) fn run(store: &ProjectStore, storage: &StorageManager, project: &str) -> Result<DeleteProjectResult, CommandError> {
    run_with_policy(store, storage, project, parse(include_str!("project-deletion-policy.json"))?)
}
fn run_with_policy(store: &ProjectStore, storage: &StorageManager, project: &str, policy: Policy) -> Result<DeleteProjectResult, CommandError> {
    let _usage = storage.acquire_usage()?;
    let closing = crate::project_operations::Deletion::begin(store, project)?;
    let remote = storage.remote_media_root()?;
    let deadline = Instant::now() + Duration::from_millis(policy.timeout_ms);
    loop {
        request_cancellation(store, project)?;
        if closing.is_idle()? {
            // An admitted preparer may have created a task after the first scan.
            request_cancellation(store, project)?;
            if active_tasks(store, project)?.is_empty() && summary_active(store, project)? == 0 {
                return store.delete_project_with_permit(project, &remote, &closing).map_err(Into::into);
            }
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(CommandError { code: "project_delete_timeout", message: "后台工作尚未结束，项目和文件已保留；请稍后重试删除".into() });
        }
        thread::sleep(Duration::from_millis(policy.poll_ms).min(remaining));
    }
}
const TABLES: [(&str, &str); 5] = [
    ("transcription_jobs", "'queued','extracting','transcribing','validating'"),
    ("agent_tasks", "'awaiting_external_result','queued','running','validating'"),
    ("explanation_tasks", "'awaiting_external_result','queued','running','validating'"),
    ("learning_tasks", "'awaiting_external_result','queued','running','validating'"),
    ("subtitle_burn_jobs", "'queued','running','validating'"),
];
fn active_tasks(store: &ProjectStore, project: &str) -> Result<Vec<(usize, String)>, CommandError> {
    let connection = store.connect()?;
    let mut tasks = Vec::new();
    for (index, (table, statuses)) in TABLES.iter().enumerate() {
        let mut statement = connection.prepare(&format!("SELECT id FROM {table} WHERE project_id = ?1 AND status IN ({statuses})")).map_err(crate::store::StoreError::from)?;
        let ids = statement.query_map([project], |row| row.get::<_, String>(0)).map_err(crate::store::StoreError::from)?;
        for id in ids { tasks.push((index, id.map_err(crate::store::StoreError::from)?)); }
    }
    Ok(tasks)
}
fn summary_active(store: &ProjectStore, project: &str) -> Result<i64, CommandError> {
    store.connect()?.query_row("SELECT COUNT(*) FROM summary_tasks WHERE project_id = ?1 AND status NOT IN ('completed','failed','cancelled')", [project], |row| row.get(0))
        .map_err(crate::store::StoreError::from).map_err(Into::into)
}
fn request_cancellation(store: &ProjectStore, project: &str) -> Result<(), CommandError> {
    crate::summary::cancel_project_tasks(store, project)?;
    crate::preparation::cancel_project(project).map_err(|error| CommandError { code: "preparation_cancel_failed", message: error.to_string() })?;
    for (kind, id) in active_tasks(store, project)? {
        let result = match kind {
            0 => crate::transcription::cancel_transcription_job(store, &id).map(|_| ()).map_err(|error| error.to_string()),
            1 => crate::codex_runner::cancel_translation_task(store, &id).map(|_| ()).map_err(|error| error.to_string()),
            2 => crate::codex_runner::cancel_explanation_task(store, &id).map(|_| ()).map_err(|error| error.to_string()),
            3 => crate::codex_runner::cancel_learning_task(store, &id).map(|_| ()).map_err(|error| error.to_string()),
            _ => crate::burn::cancel_subtitle_burn_job(store, &id).map(|_| ()).map_err(|error| error.to_string()),
        };
        if let Err(message) = result {
            if active_tasks(store, project)?.iter().any(|(current_kind, current_id)| *current_kind == kind && current_id == &id) {
                return Err(CommandError { code: "project_cancel_failed", message });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "project_deletion_tests.rs"]
mod tests;
