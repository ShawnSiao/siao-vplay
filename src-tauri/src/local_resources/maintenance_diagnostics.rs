use super::*;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ResourceChangeState {
    None,
    ActivationPending,
    RemovalPending,
    Conflicting,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ResourceMaintenanceScanState {
    NotConfigured,
    Complete,
    Partial,
    RootUnavailable,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ResourceMaintenanceDiagnostics {
    pub transaction_state: ResourceChangeState,
    pub scan_state: ResourceMaintenanceScanState,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub staging_review_count: usize,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub receipt_recovery_copy_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Policy {
    maximum_entries: usize,
}
fn scan_limit() -> Result<usize, LocalResourceError> {
    let policy: Policy = serde_json::from_str(include_str!("maintenance-policy.json"))?;
    if !(1..=1_000_000).contains(&policy.maximum_entries) {
        return Err(io::Error::other("资源诊断扫描上限无效").into());
    }
    Ok(policy.maximum_entries)
}

pub(super) fn inspect(
    manager: &LocalResourceManager,
) -> Result<ResourceMaintenanceDiagnostics, LocalResourceError> {
    inspect_with_limit(manager, scan_limit()?)
}

fn inspect_with_limit(
    manager: &LocalResourceManager,
    limit: usize,
) -> Result<ResourceMaintenanceDiagnostics, LocalResourceError> {
    // Observation only: never parse, restore, rename or delete recovery records here.
    let transaction_state = match (
        activation::pending(&manager.config_path),
        removal::pending(&manager.config_path),
    ) {
        (Ok(false), Ok(false)) => ResourceChangeState::None,
        (Ok(true), Ok(false)) => ResourceChangeState::ActivationPending,
        (Ok(false), Ok(true)) => ResourceChangeState::RemovalPending,
        (Ok(true), Ok(true)) => ResourceChangeState::Conflicting,
        _ => ResourceChangeState::Unavailable,
    };
    let mut result = ResourceMaintenanceDiagnostics {
        transaction_state,
        scan_state: ResourceMaintenanceScanState::NotConfigured,
        staging_review_count: 0,
        receipt_recovery_copy_count: 0,
    };
    let Some(configuration) = &manager.configuration else {
        return Ok(result);
    };
    let root = configuration_root(configuration);
    if !transaction_paths::directory(&root).unwrap_or(false) {
        result.scan_state = ResourceMaintenanceScanState::RootUnavailable;
        return Ok(result);
    }
    result.scan_state = ResourceMaintenanceScanState::Complete;
    let mut scan = Scan {
        remaining: limit,
        partial: false,
    };
    for path in scan.entries(&root.join("staging")) {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if ["install-backup-", "version-cleanup-", "removal-"]
            .iter()
            .any(|prefix| name.starts_with(prefix))
        {
            result.staging_review_count += 1;
        }
    }
    for directory in scan.entries(&root.join("receipts")) {
        for path in scan.entries(&directory) {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name.ends_with(".json.bak") || name.ends_with(".json.part") {
                result.receipt_recovery_copy_count += 1;
            }
        }
    }
    if scan.partial {
        result.scan_state = ResourceMaintenanceScanState::Partial;
    }
    Ok(result)
}

struct Scan {
    remaining: usize,
    partial: bool,
}
impl Scan {
    fn entries(&mut self, path: &Path) -> Vec<PathBuf> {
        match transaction_paths::directory(path) {
            Ok(false) => return Vec::new(),
            Err(_) => {
                self.partial = true;
                return Vec::new();
            }
            Ok(true) => {}
        }
        let Ok(entries) = fs::read_dir(path) else {
            self.partial = true;
            return Vec::new();
        };
        let mut result = Vec::new();
        for entry in entries {
            if self.remaining == 0 {
                self.partial = true;
                break;
            }
            self.remaining -= 1;
            match entry {
                Ok(entry) => result.push(entry.path()),
                Err(_) => self.partial = true,
            }
        }
        result
    }
}

#[cfg(test)]
mod tests;
