use super::task_types::AiTaskError;
use crate::store::ProjectStore;
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

type Key = (PathBuf, String);
fn active() -> &'static Mutex<HashSet<Key>> {
    static ACTIVE: OnceLock<Mutex<HashSet<Key>>> = OnceLock::new();
    ACTIVE.get_or_init(Mutex::default)
}

/// Held until both the owned request and result persistence have stopped.
#[must_use = "Keep API execution ownership until the request and result handling finish"]
pub(crate) struct ApiExecutionLease(Key, #[allow(dead_code)] crate::project_operations::Operation);
impl ApiExecutionLease {
    pub(crate) fn acquire(store: &ProjectStore, task_id: &str, project_id: &str) -> Result<Self, AiTaskError> {
        let project = crate::project_operations::Operation::acquire(store, project_id)?;
        let key = (
            dunce::canonicalize(store.database_path())?,
            task_id.to_owned(),
        );
        let mut tasks = active()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !tasks.insert(key.clone()) {
            return Err(
                super::AiError::Validation("上次请求仍在结束，请稍后重试".to_owned()).into(),
            );
        }
        Ok(Self(key, project))
    }
}
impl Drop for ApiExecutionLease {
    fn drop(&mut self) {
        active()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.0);
    }
}
