mod files;
use super::transaction_paths as paths_io;
use super::*;
const JOURNAL: &str = "resource-removal.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    schema_version: u32,
    previous: LocalResourceConfiguration,
    next: LocalResourceConfiguration,
    receipt: ResourceReceipt,
    receipt_raw: String,
    staging_id: String,
    had_payload: bool,
    #[serde(default)]
    mode: Mode,
    #[serde(default)]
    committed: bool,
}
#[derive(Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Mode {
    #[default]
    Active,
    Inactive,
}
fn invalid() -> LocalResourceError {
    LocalResourceError::InvalidReceipt(
        "资源删除记录与当前状态不匹配，已保留文件，请检查后重试".into(),
    )
}
fn journal_path(config: &Path) -> Result<PathBuf, LocalResourceError> {
    Ok(config.parent().ok_or_else(invalid)?.join(JOURNAL))
}
fn validate(journal: &Journal) -> Result<(), LocalResourceError> {
    if !matches!(journal.schema_version, 1 | 2)
        || (journal.schema_version == 1 && (journal.mode != Mode::Active || journal.committed))
        || (journal.mode == Mode::Active && journal.committed)
    {
        return Err(invalid());
    }
    validate_configuration(&journal.previous)?;
    validate_configuration(&journal.next)?;
    let receipt = &journal.receipt;
    validate_identifier(&receipt.resource_id, "资源 ID")?;
    validate_identifier(&receipt.version, "资源版本")?;
    validate_receipt(receipt, &receipt.resource_id, &receipt.version)?;
    let expected_raw: ResourceReceipt = serde_json::from_str(&journal.receipt_raw)?;
    if expected_raw != *receipt {
        return Err(invalid());
    }
    let active =
        journal.previous.active_resources.get(&receipt.resource_id) == Some(&receipt.version);
    let mut next = journal.previous.clone();
    match journal.mode {
        Mode::Active if active => {
            next.active_resources.remove(&receipt.resource_id);
        }
        Mode::Inactive if !active => {}
        _ => return Err(invalid()),
    }
    if next != journal.next {
        return Err(invalid());
    }
    if !["packages", "models"].iter().any(|category| {
        receipt.install_relative_path
            == format!("{category}/{}/{}", receipt.resource_id, receipt.version)
    }) {
        return Err(invalid());
    }
    let id = uuid::Uuid::parse_str(&journal.staging_id).map_err(|_| invalid())?;
    if id.to_string() != journal.staging_id {
        return Err(invalid());
    }
    Ok(())
}
fn paths(journal: &Journal) -> Result<(PathBuf, PathBuf, PathBuf), LocalResourceError> {
    let root = configuration_root(&journal.previous);
    let install = paths_io::contained(&root, &journal.receipt.install_relative_path)?;
    let stage = paths_io::contained(&root, &format!("staging/removal-{}", journal.staging_id))?;
    let receipt = paths_io::contained(
        &root,
        &format!(
            "receipts/{}/{}.json",
            journal.receipt.resource_id, journal.receipt.version
        ),
    )?;
    Ok((install, stage, receipt))
}
pub(super) fn pending(config: &Path) -> Result<bool, LocalResourceError> {
    let path = journal_path(config)?;
    for candidate in [
        path.clone(),
        path.with_extension("json.bak"),
        path.with_extension("json.part"),
    ] {
        if paths_io::metadata(&candidate)?.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}
pub(super) fn recover(config: &Path) -> Result<bool, LocalResourceError> {
    let path = journal_path(config)?;
    let Some(journal) = persistence::read_recovering(&path, validate)? else {
        return Ok(false);
    };
    let current = persistence::load_configuration(config)?.ok_or_else(invalid)?;
    let committed = current == journal.next && (journal.mode == Mode::Active || journal.committed);
    if !committed && current != journal.previous {
        return Err(invalid());
    }
    let (install, stage, receipt) = paths(&journal)?;
    paths_io::check_record(&receipt)?;
    let receipt_raw = match fs::read_to_string(&receipt) {
        Ok(raw) => Some(raw),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if receipt_raw
        .as_ref()
        .is_some_and(|raw| raw != &journal.receipt_raw)
        || (!committed && receipt_raw.is_none())
    {
        return Err(invalid());
    }
    let installed = paths_io::directory(&install)?;
    let staged = paths_io::directory(&stage)?;
    if committed {
        if installed || (staged && !journal.had_payload) {
            return Err(invalid());
        }
        if staged {
            paths_io::check_tree(&stage)?;
        }
        persistence::remove_record(&receipt)?;
        if staged {
            fs::remove_dir_all(&stage)?;
        }
    } else {
        if journal.had_payload {
            if installed == staged {
                return Err(invalid());
            }
            if staged {
                fs::rename(&stage, &install)?;
            }
        } else if installed || staged {
            return Err(invalid());
        }
    }
    persistence::remove_record(&path)?;
    Ok(true)
}
pub(super) fn remove(
    manager: &mut LocalResourceManager,
    resource_id: &str,
) -> Result<Option<ResourceReceipt>, LocalResourceError> {
    if recover(&manager.config_path)? {
        manager.configuration = persistence::load_configuration(&manager.config_path)?;
    }
    let Some(receipt) = manager.active_receipt(resource_id)? else {
        return Ok(None);
    };
    execute(manager, receipt, Mode::Active, |_| Ok(()))
}
pub(super) fn remove_inactive(
    manager: &mut LocalResourceManager,
    resource_id: &str,
    version: &str,
) -> Result<bool, LocalResourceError> {
    if recover(&manager.config_path)? {
        manager.configuration = persistence::load_configuration(&manager.config_path)?;
    }
    validate_identifier(resource_id, "资源 ID")?;
    validate_identifier(version, "资源版本")?;
    let configuration = manager
        .configuration
        .as_ref()
        .ok_or(LocalResourceError::ConfirmationRequired)?;
    if configuration
        .active_resources
        .get(resource_id)
        .is_some_and(|active| active == version)
    {
        return Err(LocalResourceError::ResourceNotReady(format!(
            "不能删除活动版本 {resource_id}@{version}"
        )));
    }
    let target = paths_io::contained(
        &configuration_root(configuration),
        &format!("receipts/{resource_id}/{version}.json"),
    )?;
    paths_io::check_record(&target)?;
    let receipt = persistence::read_recovering(&target, |receipt| {
        validate_receipt(receipt, resource_id, version)
    })?;
    let Some(receipt) = receipt else {
        return Ok(false);
    };
    Ok(execute(manager, receipt, Mode::Inactive, |_| Ok(()))?.is_some())
}
fn execute(
    manager: &mut LocalResourceManager,
    receipt: ResourceReceipt,
    mode: Mode,
    before_commit: impl FnOnce(&Path) -> Result<(), LocalResourceError>,
) -> Result<Option<ResourceReceipt>, LocalResourceError> {
    let previous = manager.configuration.clone().ok_or_else(invalid)?;
    let mut next = previous.clone();
    if mode == Mode::Active {
        next.active_resources.remove(&receipt.resource_id);
    }
    let mut journal = Journal {
        schema_version: 2,
        previous,
        next,
        receipt,
        receipt_raw: String::new(),
        staging_id: uuid::Uuid::new_v4().to_string(),
        had_payload: false,
        mode,
        committed: false,
    };
    let (install, stage, target) = paths(&journal)?;
    paths_io::check_record(&target)?;
    let restored = persistence::read_recovering(&target, |receipt| {
        validate_receipt(
            receipt,
            &journal.receipt.resource_id,
            &journal.receipt.version,
        )
    })?;
    if restored.as_ref() != Some(&journal.receipt) {
        return Err(invalid());
    }
    journal.receipt_raw = fs::read_to_string(&target)?;
    journal.had_payload = paths_io::directory(&install)?;
    if journal.had_payload {
        paths_io::check_tree(&install)?;
    }
    if paths_io::metadata(&stage)?.is_some() {
        return Err(invalid());
    }
    validate(&journal)?;
    files::prepare(&journal_path(&manager.config_path)?, &journal)?;
    let operation = (|| -> Result<(), LocalResourceError> {
        if journal.had_payload {
            fs::rename(&install, &stage)?;
        }
        before_commit(&journal_path(&manager.config_path)?)?;
        if journal.mode == Mode::Active {
            persist_json(&manager.config_path, &journal.next)?;
        } else {
            journal.committed = true;
            persist_json(&journal_path(&manager.config_path)?, &journal)?;
        }
        Ok(())
    })();
    // Adopt committed configuration before cleanup, including when cleanup must be retried.
    manager.configuration = persistence::load_configuration(&manager.config_path)?;
    recover(&manager.config_path)?;
    operation?;
    Ok(Some(journal.receipt))
}
#[cfg(test)]
mod history_tests;
#[cfg(test)]
mod tests;
