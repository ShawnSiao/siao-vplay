use std::{collections::BTreeMap, io, path::PathBuf, sync::{Arc, Mutex, OnceLock, Weak}};
use crate::store::{ProjectStore, StoreError};
#[derive(Default)]
struct State { users: usize, deleting: bool }
#[derive(Default)]
struct Gate(Mutex<State>);
fn gate(store: &ProjectStore, project: &str) -> io::Result<Arc<Gate>> {
    type Registry = BTreeMap<(PathBuf, String), Weak<Gate>>;
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    let key = (dunce::canonicalize(store.database_path())?, project.to_owned());
    let mut registry = REGISTRY.get_or_init(Default::default).lock().map_err(|_| io::Error::other("项目操作状态不可用"))?;
    registry.retain(|_, gate| gate.strong_count() > 0);
    let entry = registry.entry(key).or_default();
    if let Some(gate) = entry.upgrade() { return Ok(gate); }
    let gate = Arc::new(Gate::default());
    *entry = Arc::downgrade(&gate);
    Ok(gate)
}
fn busy() -> io::Error { io::Error::new(io::ErrorKind::WouldBlock, "项目仍有操作正在结束或正在删除，请稍后重试") }
#[must_use]
pub(crate) struct Operation(Arc<Gate>);
impl Operation {
    pub(crate) fn ensure_project(&self, store: &ProjectStore, project: &str) -> Result<(), StoreError> {
        if !Arc::ptr_eq(&self.0, &gate(store, project)?) {
            return Err(StoreError::Validation("项目操作使用权与当前项目不一致".into()));
        }
        Ok(())
    }
    pub(crate) fn acquire(store: &ProjectStore, project: &str) -> Result<Self, StoreError> {
        let gate = gate(store, project)?;
        {
            let mut state = gate.0.lock().map_err(|_| io::Error::other("项目操作状态不可用"))?;
            if state.deleting { return Err(busy().into()); }
            state.users += 1;
        }
        let lease = Self(gate);
        store.get_project(project)?;
        Ok(lease)
    }
}
impl Drop for Operation {
    fn drop(&mut self) { self.0.0.lock().unwrap_or_else(|error| error.into_inner()).users -= 1; }
}
#[must_use]
pub(crate) struct Deletion(Arc<Gate>);
impl Deletion {
    pub(crate) fn acquire(store: &ProjectStore, project: &str) -> Result<Self, StoreError> {
        let gate = gate(store, project)?;
        {
            let mut state = gate.0.lock().map_err(|_| io::Error::other("项目操作状态不可用"))?;
            if state.deleting || state.users > 0 { return Err(busy().into()); }
            state.deleting = true;
        }
        Ok(Self(gate))
    }
}
impl Drop for Deletion {
    fn drop(&mut self) { self.0.0.lock().unwrap_or_else(|error| error.into_inner()).deleting = false; }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::CreateLocalProjectInput;
    #[test]
    fn deletion_retains_project_until_worker_releases_ownership() {
        let data = tempfile::tempdir().unwrap();
        let store = ProjectStore::open(data.path().join("projects/siaovplay.db")).unwrap();
        let media = data.path().join("authorized.mp4");
        std::fs::write(&media, b"retain source").unwrap();
        let project = store.create_local_project(CreateLocalProjectInput { media_path: media.to_string_lossy().into_owned(), title: None }).unwrap();
        let operation = Operation::acquire(&store, &project.id).unwrap();
        let (release, wait) = std::sync::mpsc::channel();
        let worker_store = store.clone(); let id = project.id.clone();
        let worker = std::thread::spawn(move || {
            let _operation = operation;
            wait.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
            worker_store.get_project(&id).is_ok()
        });
        let deletion = store.delete_project(&project.id);
        release.send(()).unwrap();
        let worker_found_project = worker.join().unwrap();
        assert!(deletion.is_err(), "delete must not remove an owned project");
        assert!(worker_found_project);
        let deleting = Deletion::acquire(&store, &project.id).unwrap();
        assert!(Operation::acquire(&store, &project.id).is_err());
        drop(deleting);
        assert!(store.delete_project(&project.id).unwrap().deleted);
        assert!(Operation::acquire(&store, &project.id).is_err());
        assert_eq!(std::fs::read(media).unwrap(), b"retain source");
    }
}
