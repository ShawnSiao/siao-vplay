use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    sync::{Arc, Mutex},
    thread::ThreadId,
};

#[derive(Clone, Debug)]
pub(crate) enum Scope {
    All,
    Policy,
    Resource(String),
}
impl Scope {
    fn includes(&self, resources: &BTreeSet<String>) -> bool {
        match self {
            Self::All => true,
            Self::Policy => false,
            Self::Resource(id) => resources.contains(id),
        }
    }
    fn overlaps(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Resource(a), Self::Resource(b)) => a == b,
            (Self::Policy, Self::Resource(_)) | (Self::Resource(_), Self::Policy) => false,
            _ => true,
        }
    }
}

#[derive(Debug, Default)]
struct UsageState {
    next_id: u64,
    readers: BTreeMap<u64, BTreeSet<String>>,
    writers: BTreeMap<u64, (ThreadId, Scope)>,
}

#[derive(Debug, Default)]
pub(crate) struct ResourceUsage {
    state: Mutex<UsageState>,
}

#[derive(Clone, Debug)]
pub(crate) struct ResourceLease {
    _record: Arc<LeaseRecord>,
}
#[derive(Debug)]
struct LeaseRecord {
    registry: Arc<ResourceUsage>,
    id: u64,
    writer: bool,
    _versions: BTreeMap<String, String>,
}
impl Drop for LeaseRecord {
    fn drop(&mut self) {
        let mut state = self
            .registry
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if self.writer {
            state.writers.remove(&self.id);
        } else {
            state.readers.remove(&self.id);
        }
    }
}

impl ResourceUsage {
    pub(crate) fn read(
        self: &Arc<Self>,
        snapshot: impl FnOnce() -> BTreeMap<String, String>,
    ) -> io::Result<ResourceLease> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("资源使用状态不可用"))?;
        let versions = snapshot();
        let resources = versions.keys().cloned().collect();
        let thread = std::thread::current().id();
        if state
            .writers
            .values()
            .any(|(owner, scope)| *owner != thread && scope.includes(&resources))
        {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "本地资源正在维护，请完成后重试",
            ));
        }
        state.next_id += 1;
        let id = state.next_id;
        state.readers.insert(id, resources);
        Ok(ResourceLease {
            _record: Arc::new(LeaseRecord {
                registry: self.clone(),
                id,
                writer: false,
                _versions: versions,
            }),
        })
    }

    pub(crate) fn write(self: &Arc<Self>, scope: Scope) -> io::Result<ResourceLease> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("资源使用状态不可用"))?;
        let thread = std::thread::current().id();
        if state
            .readers
            .values()
            .any(|resources| scope.includes(resources))
            || state
                .writers
                .values()
                .any(|(owner, held)| *owner != thread && scope.overlaps(held))
        {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "本地资源正被任务使用或维护，请等待完成或取消任务后重试",
            ));
        }
        state.next_id += 1;
        let id = state.next_id;
        state
            .writers
            .insert(id, (std::thread::current().id(), scope));
        Ok(ResourceLease {
            _record: Arc::new(LeaseRecord {
                registry: self.clone(),
                id,
                writer: true,
                _versions: BTreeMap::new(),
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn version() -> BTreeMap<String, String> {
        [("ffmpeg".into(), "8.1.1".into())].into()
    }

    #[test]
    fn maintenance_waits_for_the_last_consumer_clone() {
        let registry = Arc::new(ResourceUsage::default());
        let lease = registry.read(version).unwrap();
        let last = lease.clone();
        drop(lease);
        assert!(registry.write(Scope::All).is_err());
        assert!(registry.write(Scope::Resource("ffmpeg".into())).is_err());
        assert!(registry.write(Scope::Resource("new-model".into())).is_ok());
        drop(last);
        assert!(registry.write(Scope::All).is_ok());
    }

    #[test]
    fn another_thread_cannot_resolve_paths_during_maintenance() {
        let registry = Arc::new(ResourceUsage::default());
        let _maintenance = registry.write(Scope::All).unwrap();
        let worker = registry.clone();
        assert!(
            std::thread::spawn(move || worker.read(version).is_err())
                .join()
                .unwrap()
        );
        let worker = registry.clone();
        assert!(
            std::thread::spawn(move || worker.write(Scope::All).is_err())
                .join()
                .unwrap()
        );
        // Nested maintenance calls on the same worker retain the outer guard.
        assert!(registry.write(Scope::Resource("ffmpeg".into())).is_ok());
    }
    #[test]
    fn policy_changes_coexist_with_consumers_but_not_global_maintenance() {
        let registry = Arc::new(ResourceUsage::default());
        let consumer = registry.read(version).unwrap();
        let policy = registry.write(Scope::Policy).unwrap();
        drop(consumer);
        let other = registry.clone();
        assert!(std::thread::spawn(move || other.write(Scope::All).is_err()).join().unwrap());
        drop(policy);
        let maintenance = registry.write(Scope::All).unwrap();
        let other = registry.clone();
        assert!(std::thread::spawn(move || other.write(Scope::Policy).is_err()).join().unwrap());
        drop(maintenance);
        assert!(registry.write(Scope::Policy).is_ok());
    }

}
