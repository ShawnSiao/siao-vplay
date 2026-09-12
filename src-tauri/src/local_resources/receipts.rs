use super::*;

fn candidate(
    configuration: &LocalResourceConfiguration,
    resource_id: &str,
    version: &str,
    suffix: &str,
) -> Result<Option<ResourceReceipt>, LocalResourceError> {
    let path = transaction_paths::contained(
        &configuration_root(configuration),
        &format!("receipts/{resource_id}/{version}.{suffix}"),
    )?;
    persistence::read_candidate(&path, &|receipt| {
        validate_receipt(receipt, resource_id, version)
    })
}
pub(super) fn read(
    configuration: &LocalResourceConfiguration,
    resource_id: &str,
    version: &str,
) -> Result<ResourceReceipt, LocalResourceError> {
    validate_identifier(resource_id, "资源 ID")?;
    validate_identifier(version, "资源版本")?;
    if let Some(receipt) = candidate(configuration, resource_id, version, "json")? {
        return Ok(receipt);
    }
    // An active configuration identifies the committed revision. Legacy inactive
    // backups and uncommitted .part files cannot prove that deletion was unintended.
    if configuration
        .active_resources
        .get(resource_id)
        .is_some_and(|active| active == version)
    {
        if let Some(receipt) = candidate(configuration, resource_id, version, "json.bak")? {
            return Ok(receipt);
        }
    }
    Err(LocalResourceError::ResourceNotReady(format!(
        "缺少资源安装凭据：{resource_id}@{version}"
    )))
}
pub(super) fn list(
    configuration: Option<&LocalResourceConfiguration>,
    resource_id: &str,
) -> Result<Vec<ResourceReceipt>, LocalResourceError> {
    inventory(configuration, resource_id).map(|inventory| inventory.receipts)
}

#[derive(Default)]
pub(crate) struct ReceiptInventory {
    pub receipts: Vec<ResourceReceipt>,
    pub unverified_count: usize,
}

pub(super) fn inventory(
    configuration: Option<&LocalResourceConfiguration>,
    resource_id: &str,
) -> Result<ReceiptInventory, LocalResourceError> {
    validate_identifier(resource_id, "资源 ID")?;
    let Some(configuration) = configuration else {
        return Ok(ReceiptInventory::default());
    };
    let root = configuration_root(configuration);
    if !root.is_dir() {
        return Ok(ReceiptInventory::default());
    }
    let directory = transaction_paths::contained(&root, &format!("receipts/{resource_id}"))?;
    let entries = if transaction_paths::metadata(&directory)?.is_some() {
        Some(fs::read_dir(directory)?)
    } else {
        None
    };
    let mut receipts = Vec::new();
    let mut unverified_count = 0;
    let mut active_primary_seen = false;
    let active = configuration.active_resources.get(resource_id);
    for entry in entries.into_iter().flatten() {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(version) = path.file_stem().and_then(|value| value.to_str()) else {
            unverified_count += 1;
            continue;
        };
        active_primary_seen |= active.is_some_and(|active| active == version);
        if !entry.file_type()?.is_file() || validate_identifier(version, "资源版本").is_err() {
            unverified_count += 1;
            continue;
        }
        match candidate(configuration, resource_id, version, "json") {
            Ok(Some(receipt)) => receipts.push(receipt),
            Ok(None)
            | Err(LocalResourceError::Serialization(_))
            | Err(LocalResourceError::InvalidReceipt(_)) => unverified_count += 1,
            Err(error) => return Err(error),
        }
    }
    if let Some(active) = active {
        if !receipts.iter().any(|receipt| &receipt.version == active) {
            match read(configuration, resource_id, active) {
                Ok(receipt) => receipts.push(receipt),
                Err(_) if !active_primary_seen => unverified_count += 1,
                Err(_) => {}
            }
        }
    }
    receipts.sort_by(|left, right| {
        right
            .activated_at_ms
            .unwrap_or_default()
            .cmp(&left.activated_at_ms.unwrap_or_default())
            .then(right.version.cmp(&left.version))
    });
    Ok(ReceiptInventory {
        receipts,
        unverified_count,
    })
}
