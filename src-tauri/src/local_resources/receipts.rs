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
    validate_identifier(resource_id, "资源 ID")?;
    let Some(configuration) = configuration else {
        return Ok(Vec::new());
    };
    let root = configuration_root(configuration);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let directory = transaction_paths::contained(&root, &format!("receipts/{resource_id}"))?;
    if transaction_paths::metadata(&directory)?.is_none() {
        return Ok(Vec::new());
    }
    let mut receipts = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if !entry.file_type()?.is_file()
            || path.extension().and_then(|value| value.to_str()) != Some("json")
        {
            continue;
        }
        let Some(version) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if validate_identifier(version, "资源版本").is_err() {
            continue;
        }
        match candidate(configuration, resource_id, version, "json") {
            Ok(Some(receipt)) => receipts.push(receipt),
            Ok(None)
            | Err(LocalResourceError::Serialization(_))
            | Err(LocalResourceError::InvalidReceipt(_)) => {}
            Err(error) => return Err(error),
        }
    }
    if let Some(active) = configuration.active_resources.get(resource_id) {
        if !receipts.iter().any(|receipt| &receipt.version == active) {
            if let Ok(receipt) = read(configuration, resource_id, active) {
                receipts.push(receipt);
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
    Ok(receipts)
}
