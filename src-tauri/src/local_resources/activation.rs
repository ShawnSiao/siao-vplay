mod payload;
mod prepare;
use super::*;
const JOURNAL: &str = "resource-activation.json";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    schema_version: u32,
    previous: LocalResourceConfiguration,
    next: LocalResourceConfiguration,
    previous_receipt: Option<String>,
    next_receipt: ResourceReceipt,
    committed: bool,
    #[serde(default)]
    payload: Option<payload::Payload>,
}
#[derive(PartialEq, Eq, Debug)]
pub(super) enum Recovery {
    None,
    RolledBack,
    Committed,
}
fn invalid() -> LocalResourceError {
    LocalResourceError::InvalidReceipt(
        "资源激活记录与当前状态不匹配，已保留文件，请检查后重试".into(),
    )
}
fn journal_path(config: &Path) -> Result<PathBuf, LocalResourceError> {
    Ok(config.parent().ok_or_else(invalid)?.join(JOURNAL))
}
fn validate(journal: &Journal) -> Result<(), LocalResourceError> {
    if !matches!(journal.schema_version, 1 | 2)
        || (journal.schema_version == 1 && journal.payload.is_some())
    {
        return Err(invalid());
    }
    validate_configuration(&journal.previous)?;
    validate_configuration(&journal.next)?;
    let receipt = &journal.next_receipt;
    validate_identifier(&receipt.resource_id, "资源 ID")?;
    validate_identifier(&receipt.version, "资源版本")?;
    validate_receipt(receipt, &receipt.resource_id, &receipt.version)?;
    if receipt.health_status != "passed" {
        return Err(invalid());
    }
    let mut expected = journal.previous.clone();
    expected
        .active_resources
        .insert(receipt.resource_id.clone(), receipt.version.clone());
    if expected != journal.next {
        return Err(invalid());
    }
    if let Some(raw) = &journal.previous_receipt {
        let previous = serde_json::from_str(raw)?;
        validate_receipt(&previous, &receipt.resource_id, &receipt.version)?;
    }
    if let Some(payload) = &journal.payload {
        payload::validate(journal, payload)?;
    }
    Ok(())
}
#[cfg(test)]
fn receipt_path(journal: &Journal) -> PathBuf {
    configuration_root(&journal.previous)
        .join("receipts")
        .join(&journal.next_receipt.resource_id)
        .join(format!("{}.json", journal.next_receipt.version))
}
fn remove_regular(path: &Path) -> Result<(), LocalResourceError> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
        Ok(metadata) if metadata.file_type().is_file() => fs::remove_file(path).map_err(Into::into),
        Ok(_) => Err(invalid()),
    }
}
fn clear(path: &Path) -> Result<(), LocalResourceError> {
    // Remove sidecars first so a crash cannot resurrect a cleared primary journal.
    remove_regular(&path.with_extension("json.part"))?;
    remove_regular(&path.with_extension("json.bak"))?;
    remove_regular(path)
}
pub(super) fn pending(config: &Path) -> Result<bool, LocalResourceError> {
    let path = journal_path(config)?;
    for candidate in [
        &path,
        &path.with_extension("json.bak"),
        &path.with_extension("json.part"),
    ] {
        match fs::symlink_metadata(candidate) {
            Ok(_) => return Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(false)
}
pub(super) fn recover(config: &Path) -> Result<Recovery, LocalResourceError> {
    let path = journal_path(config)?;
    let Some(journal) = persistence::read_recovering(&path, validate)? else {
        return Ok(Recovery::None);
    };
    let current = persistence::load_configuration(config)?.ok_or_else(invalid)?;
    let committed =
        current == journal.next && (journal.committed || journal.previous != journal.next);
    if !committed && current != journal.previous {
        return Err(invalid());
    }
    let target = transaction_paths::contained(
        &configuration_root(&journal.previous),
        &format!(
            "receipts/{}/{}.json",
            journal.next_receipt.resource_id, journal.next_receipt.version
        ),
    )?;
    transaction_paths::check_record(&target)?;
    let current_receipt = match fs::read(&target) {
        Ok(bytes) => Some(serde_json::from_slice::<ResourceReceipt>(&bytes)?),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let previous_receipt = journal
        .previous_receipt
        .as_deref()
        .map(serde_json::from_str::<ResourceReceipt>)
        .transpose()?;
    if current_receipt.as_ref().is_some_and(|receipt| {
        receipt != &journal.next_receipt && Some(receipt) != previous_receipt.as_ref()
    }) {
        return Err(invalid());
    }
    if let Some(payload) = &journal.payload {
        payload::recover(&journal, payload, committed)?;
    }
    if committed {
        if current_receipt
            .as_ref()
            .is_some_and(|receipt| receipt != &journal.next_receipt)
        {
            return Err(invalid());
        }
        if current_receipt.is_none() {
            persist_json(&target, &journal.next_receipt)?;
        }
    } else if let Some(raw) = &journal.previous_receipt {
        persistence::persist_raw_json(&target, raw)?;
    } else {
        clear(&target)?;
    }
    remove_regular(&target.with_extension("json.part"))?;
    remove_regular(&target.with_extension("json.bak"))?;
    if committed {
        if let Some(payload) = &journal.payload {
            payload::finish(&journal, payload)?;
        }
    }
    clear(&path)?;
    Ok(if committed {
        Recovery::Committed
    } else {
        Recovery::RolledBack
    })
}
pub(super) fn activate(
    manager: &mut LocalResourceManager,
    receipt: ResourceReceipt,
) -> Result<(), LocalResourceError> {
    activate_inner(manager, receipt, |_| Ok(()))
}
fn activate_inner(
    manager: &mut LocalResourceManager,
    receipt: ResourceReceipt,
    after_configuration: impl FnOnce(&Path) -> Result<(), LocalResourceError>,
) -> Result<(), LocalResourceError> {
    execute(manager, receipt, None, after_configuration)
}
pub(super) fn install(
    manager: &mut LocalResourceManager,
    receipt: ResourceReceipt,
    staged: &Path,
) -> Result<(), LocalResourceError> {
    execute(manager, receipt, Some(staged), |_| Ok(()))
}
fn execute(
    manager: &mut LocalResourceManager,
    mut receipt: ResourceReceipt,
    staged: Option<&Path>,
    after_configuration: impl FnOnce(&Path) -> Result<(), LocalResourceError>,
) -> Result<(), LocalResourceError> {
    if recover(&manager.config_path)? != Recovery::None {
        manager.configuration = persistence::load_configuration(&manager.config_path)?;
    }
    let previous = manager
        .configuration
        .clone()
        .ok_or_else(|| LocalResourceError::ResourceNotReady(receipt.resource_id.clone()))?;
    validate_receipt(&receipt, &receipt.resource_id, &receipt.version)?;
    if receipt.health_status != "passed" {
        return Err(invalid());
    }
    validate_identifier(&receipt.resource_id, "资源 ID")?;
    validate_identifier(&receipt.version, "资源版本")?;
    receipt.activated_at_ms = Some(now_ms());
    let target = transaction_paths::contained(
        &configuration_root(&previous),
        &format!("receipts/{}/{}.json", receipt.resource_id, receipt.version),
    )?;
    transaction_paths::check_record(&target)?;
    let existing: Option<ResourceReceipt> = persistence::read_recovering(&target, |value| {
        validate_receipt(value, &receipt.resource_id, &receipt.version)
    })?;
    let previous_receipt = if existing.is_some() {
        Some(fs::read_to_string(&target)?)
    } else {
        None
    };
    let mut next = previous.clone();
    next.active_resources
        .insert(receipt.resource_id.clone(), receipt.version.clone());
    let mut journal = Journal {
        schema_version: 2,
        previous,
        next,
        previous_receipt,
        next_receipt: receipt,
        committed: false,
        payload: None,
    };
    if let Some(staged) = staged {
        journal.payload = Some(payload::prepare(&journal, staged)?);
    }
    validate(&journal)?;
    let path = journal_path(&manager.config_path)?;
    prepare::prepare(&path, &journal)?;
    let mut configuration_committed = false;
    let operation = (|| -> Result<(), LocalResourceError> {
        if let Some(payload) = &journal.payload {
            payload::apply(&journal, payload)?;
        }
        persist_json(&target, &journal.next_receipt)?;
        persist_json(&manager.config_path, &journal.next)?;
        configuration_committed = true;
        after_configuration(&path)?;
        journal.committed = true;
        persist_json(&path, &journal)?;
        Ok(())
    })();
    match operation {
        Ok(()) => {
            manager.configuration = Some(journal.next);
            let _ = recover(&manager.config_path);
            Ok(())
        }
        Err(_) if configuration_committed && journal.previous != journal.next => {
            // The installer must retain files referenced by the committed configuration.
            manager.configuration = Some(journal.next.clone());
            let _ = recover(&manager.config_path);
            Ok(())
        }
        Err(error) => {
            let recovery = recover(&manager.config_path)?;
            manager.configuration = persistence::load_configuration(&manager.config_path)?;
            if recovery == Recovery::Committed {
                Ok(())
            } else {
                Err(error)
            }
        }
    }
}
#[cfg(test)]
mod tests;
