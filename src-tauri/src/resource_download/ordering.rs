use std::sync::atomic::{AtomicU64, Ordering};
use super::{DownloadManager, ResourceDownloadError, ResourceDownloadTask, now_ms};

const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
static GENERATION: AtomicU64 = AtomicU64::new(0);

pub(super) fn next_generation() -> Result<u64, ResourceDownloadError> {
    GENERATION.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
        value.checked_add(1).filter(|next| *next <= MAX_SEQUENCE)
    }).map(|previous| previous + 1).map_err(|_| sequence_error())
}
fn sequence_error() -> ResourceDownloadError {
    std::io::Error::other("资源任务顺序编号已耗尽，请重新启动应用").into()
}
impl ResourceDownloadTask {
    pub(super) fn advance_revision(&mut self) -> Result<(), ResourceDownloadError> {
        self.revision = self.revision.checked_add(1).filter(|value| *value <= MAX_SEQUENCE).ok_or_else(sequence_error)?;
        Ok(())
    }
}
impl DownloadManager {
    pub(super) fn update_task_record(&mut self, id: &str,
        update: impl FnOnce(&mut ResourceDownloadTask) -> Result<(), ResourceDownloadError>,
    ) -> Result<ResourceDownloadTask, ResourceDownloadError> {
        let previous = self.tasks.get(id).cloned().ok_or_else(|| ResourceDownloadError::TaskNotFound(id.to_owned()))?;
        let mut next = previous.clone();
        update(&mut next)?;
        next.advance_revision()?;
        next.updated_at_ms = now_ms();
        self.tasks.insert(id.to_owned(), next.clone());
        if let Err(error) = self.persist() {
            self.tasks.insert(id.to_owned(), previous);
            return Err(error);
        }
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{ResourceDownloadTaskState, TASK_STORE_FILE_NAME, TASK_STORE_SCHEMA_VERSION};
    use tempfile::tempdir;
    fn add(manager: &mut DownloadManager, pending: Option<&str>) -> String {
        let resource = crate::local_resources::resource_definition("ffmpeg-cpu").unwrap();
        manager.ensure_task_record(&resource, "basic_media", pending, false).unwrap().0
    }
    #[test]
    fn root_generations_increase_even_for_empty_stores() {
        let first = DownloadManager::load(None).unwrap();
        let second = DownloadManager::load(None).unwrap();
        assert!(second.generation > first.generation);
        assert!(second.tasks.is_empty());
    }
    #[test]
    fn updates_and_new_intents_advance_revision_but_duplicate_intents_do_not() {
        let root = tempdir().unwrap();
        let mut manager = DownloadManager::load(Some(root.path().to_owned())).unwrap();
        let id = add(&mut manager, None);
        assert_eq!(manager.tasks[&id].revision, 1);
        assert_eq!(manager.tasks[&id].generation, manager.generation);
        add(&mut manager, None); assert_eq!(manager.tasks[&id].revision, 1);
        let intent = "5c2486e5-09d7-4ec6-938f-740afbf8ab80";
        add(&mut manager, Some(intent)); assert_eq!(manager.tasks[&id].revision, 2);
        add(&mut manager, Some(intent)); assert_eq!(manager.tasks[&id].revision, 2);
        let changed = manager.update_task_record(&id, |task| { task.state = ResourceDownloadTaskState::Paused; Ok(()) }).unwrap();
        assert_eq!(changed.revision, 3); assert_eq!(changed.generation, manager.generation);
    }
    #[test]
    fn old_task_files_load_with_new_stamps_and_preserve_pending_intents() {
        let root = tempdir().unwrap();
        let mut manager = DownloadManager::load(Some(root.path().to_owned())).unwrap();
        let intent = "5c2486e5-09d7-4ec6-938f-740afbf8ab80";
        let id = add(&mut manager, Some(intent));
        let mut record = serde_json::to_value(&manager.tasks[&id]).unwrap();
        record.as_object_mut().unwrap().remove("generation");
        record.as_object_mut().unwrap().remove("revision");
        super::super::persist_json_atomic(&root.path().join("state").join(TASK_STORE_FILE_NAME),
            &serde_json::json!({ "schemaVersion": TASK_STORE_SCHEMA_VERSION, "tasks": [record] })).unwrap();
        let recovered = DownloadManager::load(Some(root.path().to_owned())).unwrap();
        let task = &recovered.tasks[&id];
        assert!(task.generation > manager.generation); assert_eq!(task.revision, 2);
        assert_eq!(task.state, ResourceDownloadTaskState::Paused);
        assert_eq!(task.pending_action_ids, vec![intent]);
        assert_eq!(task.resource_id, manager.tasks[&id].resource_id);
    }
    #[test]
    fn failed_updates_and_failed_persistence_keep_the_prior_revision_and_state() {
        let root = tempdir().unwrap();
        let mut manager = DownloadManager::load(Some(root.path().to_owned())).unwrap();
        let id = add(&mut manager, None); let before = manager.tasks[&id].clone();
        assert!(manager.update_task_record(&id, |task| { task.downloaded_bytes = 100; Err(sequence_error()) }).is_err());
        assert_eq!(manager.tasks[&id], before);
        manager.root = Some(root.path().join("missing"));
        assert!(manager.update_task_record(&id, |task| { task.downloaded_bytes = 100; Ok(()) }).is_err());
        assert_eq!(manager.tasks[&id], before);
    }
}
