use crate::cancellable_process::Cancellation;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    io,
    sync::{Arc, Mutex, OnceLock},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[cfg_attr(test, schemars(rename = "MediaPreparationStage"))]
pub(crate) enum Stage {
    Queued,
    Runtime,
    Fingerprint,
    Inspect,
    Transcode,
    Validate,
    Finalize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[cfg_attr(test, schemars(rename = "MediaPreparationStatus"))]
pub(crate) enum Status {
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[cfg_attr(test, schemars(rename = "MediaPreparationProgress"))]
pub(crate) struct Snapshot {
    pub request_id: String,
    pub project_id: String,
    pub stage: Stage,
    pub status: Status,
}
impl Snapshot {
    fn active(&self) -> bool {
        matches!(self.status, Status::Running | Status::Cancelling)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Control {
    pub cancel: Cancellation,
    state: Arc<Mutex<Snapshot>>,
}
impl Control {
    pub fn stage(&self, stage: Stage) -> io::Result<()> {
        self.cancel.check()?;
        self.state
            .lock()
            .map_err(|_| io::Error::other("准备状态不可用"))?
            .stage = stage;
        Ok(())
    }
    pub fn finish(&self, status: Status) {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).status = status;
    }
    fn snapshot(&self) -> Snapshot {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    fn request_cancel(&self) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.active() {
            return false;
        }
        self.cancel.cancel();
        state.status = Status::Cancelling;
        true
    }
}

#[derive(Default)]
struct Registry {
    tasks: BTreeMap<String, Control>,
    completed_order: Vec<String>,
}
impl Registry {
    fn begin(&mut self, request_id: &str, project_id: &str) -> io::Result<Control> {
        if self.tasks.contains_key(request_id)
            || self.tasks.values().any(|task| {
                let state = task.snapshot();
                state.project_id == project_id && state.active()
            })
        {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "这段视频正在准备，请等待完成或先取消任务",
            ));
        }
        for (id, task) in &self.tasks {
            if !task.snapshot().active() && !self.completed_order.contains(id) {
                self.completed_order.push(id.clone());
            }
        }
        while self.completed_order.len() > 64 {
            let oldest = self.completed_order.remove(0);
            self.tasks.remove(&oldest);
        }
        let control = Control {
            cancel: Cancellation::default(),
            state: Arc::new(Mutex::new(Snapshot {
                request_id: request_id.to_owned(),
                project_id: project_id.to_owned(),
                stage: Stage::Queued,
                status: Status::Running,
            })),
        };
        self.tasks.insert(request_id.to_owned(), control.clone());
        Ok(control)
    }
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}
pub(crate) fn begin(request_id: &str, project_id: &str) -> io::Result<Control> {
    uuid::Uuid::parse_str(request_id).map_err(|_| io::Error::other("无效的准备任务标识"))?;
    registry()
        .lock()
        .map_err(|_| io::Error::other("准备状态不可用"))?
        .begin(request_id, project_id)
}
pub(crate) fn get(request_id: &str) -> Option<Snapshot> {
    registry()
        .lock()
        .ok()?
        .tasks
        .get(request_id)
        .map(Control::snapshot)
}
pub(crate) fn cancel(request_id: &str) -> bool {
    registry()
        .lock()
        .ok()
        .and_then(|r| r.tasks.get(request_id).map(Control::request_cancel))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_remains_active_until_worker_releases_the_project() {
        let mut registry = Registry::default();
        let first = registry.begin("first", "project").unwrap();
        assert!(first.request_cancel());
        assert_eq!(first.snapshot().status, Status::Cancelling);
        assert!(registry.begin("second", "project").is_err());
        assert!(first.stage(Stage::Transcode).is_err());
        first.finish(Status::Cancelled);
        assert!(registry.begin("second", "project").is_ok());
        assert!(!first.request_cancel());
    }
    #[test]
    fn project_and_request_identity_cannot_be_reused_while_running() {
        let mut registry = Registry::default();
        let first = registry.begin("one", "a").unwrap();
        first.stage(Stage::Transcode).unwrap();
        assert_eq!(first.snapshot().stage, Stage::Transcode);
        assert!(registry.begin("two", "a").is_err());
        assert!(registry.begin("one", "b").is_err());
        assert!(registry.begin("two", "b").is_ok());
    }
}
