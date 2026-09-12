use serde::Serialize;

#[cfg_attr(test, derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalResourceRootState {
    SetupRequired,
    Ready,
    RootUnavailable,
    RepairRequired,
}

#[cfg_attr(test, derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum LocalResourceCapabilityState {
    SetupRequired,
    NotReady,
    Preparing,
    Ready,
    RepairRequired,
    RootUnavailable,
    UpdateAvailable,
}

#[cfg_attr(test, derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceCapabilityStatus {
    pub id: String,
    pub title: String,
    pub state: LocalResourceCapabilityState,
    pub required_resource_ids: Vec<String>,
    pub missing_resource_ids: Vec<String>,
}

#[cfg_attr(test, derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceStatus {
    /// Orders snapshots within one backend process; not stored in user configuration.
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub snapshot_revision: u64,
    pub configured: bool,
    pub selected_parent: Option<String>,
    pub resource_root: Option<String>,
    pub root_state: LocalResourceRootState,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub free_space_bytes: Option<u64>,
    pub preferred_profile: String,
    pub capabilities: Vec<LocalResourceCapabilityStatus>,
}

static SNAPSHOT_REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub(super) fn next_snapshot_revision() -> Result<u64, super::LocalResourceError> {
    use std::sync::atomic::Ordering;
    SNAPSHOT_REVISION.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
        value.checked_add(1).filter(|next| *next <= 9_007_199_254_740_991)
    }).map(|previous| previous + 1).map_err(|_| std::io::Error::other("资源状态顺序编号已耗尽，请重新启动应用").into())
}

#[cfg(test)]
mod tests {
    use super::super::{LocalResourceManager, CONFIG_FILE_NAME};
    #[test]
    fn snapshots_order_configuration_profile_and_reload_without_persisting_sequence() {
        let data = tempfile::tempdir().unwrap(); let parent = tempfile::tempdir().unwrap();
        let mut manager = LocalResourceManager::load(data.path()).unwrap();
        let initial = manager.status().unwrap();
        let configured = manager.configure_location(parent.path().to_str().unwrap(), true).unwrap();
        let selected = manager.set_preferred_profile("fast").unwrap();
        let read = manager.status().unwrap();
        let reloaded = LocalResourceManager::load(data.path()).unwrap().status().unwrap();
        assert!(initial.snapshot_revision < configured.snapshot_revision);
        assert!(configured.snapshot_revision < selected.snapshot_revision);
        assert!(selected.snapshot_revision < read.snapshot_revision);
        assert!(read.snapshot_revision < reloaded.snapshot_revision);
        assert_eq!(reloaded.preferred_profile, "fast");
        let config: serde_json::Value = serde_json::from_slice(&std::fs::read(data.path().join(CONFIG_FILE_NAME)).unwrap()).unwrap();
        assert!(config.get("snapshotRevision").is_none());
    }
}
