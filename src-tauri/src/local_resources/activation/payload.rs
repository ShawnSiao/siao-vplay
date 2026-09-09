use super::super::transaction_paths as paths_io;
use super::*;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Payload {
    staged_relative: String,
    backup_id: String,
    had_previous: bool,
}
pub(super) fn validate(journal: &Journal, payload: &Payload) -> Result<(), LocalResourceError> {
    let relative = safe_relative_path(&payload.staged_relative, "安装暂存路径")?;
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 3 || parts[0].as_os_str() != "staging" || parts[2].as_os_str() != "payload" {
        return Err(invalid());
    }
    validate_identifier(
        parts[1].as_os_str().to_str().ok_or_else(invalid)?,
        "暂存身份",
    )?;
    let id = uuid::Uuid::parse_str(&payload.backup_id).map_err(|_| invalid())?;
    if id.to_string() != payload.backup_id {
        return Err(invalid());
    }
    let receipt = &journal.next_receipt;
    if !["models", "packages"].iter().any(|category| {
        receipt.install_relative_path
            == format!("{category}/{}/{}", receipt.resource_id, receipt.version)
    }) {
        return Err(invalid());
    }
    Ok(())
}
fn paths(
    journal: &Journal,
    payload: &Payload,
) -> Result<(PathBuf, PathBuf, PathBuf), LocalResourceError> {
    validate(journal, payload)?;
    let root = configuration_root(&journal.previous);
    Ok((
        paths_io::contained(&root, &payload.staged_relative)?,
        paths_io::contained(&root, &journal.next_receipt.install_relative_path)?,
        paths_io::contained(
            &root,
            &format!("staging/install-backup-{}", payload.backup_id),
        )?,
    ))
}
pub(super) fn prepare(journal: &Journal, staged: &Path) -> Result<Payload, LocalResourceError> {
    let root = configuration_root(&journal.previous);
    let relative = staged.strip_prefix(&root).map_err(|_| invalid())?;
    let mut payload = Payload {
        staged_relative: relative.to_string_lossy().replace('\\', "/"),
        backup_id: uuid::Uuid::new_v4().to_string(),
        had_previous: false,
    };
    let (stage, destination, backup) = paths(journal, &payload)?;
    if !paths_io::directory(&stage)? || paths_io::metadata(&backup)?.is_some() {
        return Err(invalid());
    }
    paths_io::check_tree(&stage)?;
    payload.had_previous = paths_io::directory(&destination)?;
    if payload.had_previous {
        paths_io::check_tree(&destination)?;
    }
    fs::create_dir_all(destination.parent().ok_or_else(invalid)?)?;
    Ok(payload)
}
pub(super) fn apply(journal: &Journal, payload: &Payload) -> Result<(), LocalResourceError> {
    let (stage, destination, backup) = paths(journal, payload)?;
    if paths_io::metadata(&backup)?.is_some()
        || !paths_io::directory(&stage)?
        || paths_io::directory(&destination)? != payload.had_previous
    {
        return Err(invalid());
    }
    if payload.had_previous {
        fs::rename(&destination, &backup)?;
    }
    fs::rename(stage, destination)?;
    Ok(())
}
pub(super) fn recover(
    journal: &Journal,
    payload: &Payload,
    committed: bool,
) -> Result<(), LocalResourceError> {
    let (stage, destination, backup) = paths(journal, payload)?;
    let staged = paths_io::directory(&stage)?;
    let installed = paths_io::directory(&destination)?;
    let backed_up = paths_io::directory(&backup)?;
    if backed_up && !payload.had_previous {
        return Err(invalid());
    }
    if committed {
        if staged || !installed {
            return Err(invalid());
        }
        return Ok(());
    }
    if payload.had_previous {
        match (staged, installed, backed_up) {
            (true, true, false) => {}
            (true, false, true) => fs::rename(&backup, &destination)?,
            (false, true, true) => {
                fs::rename(&destination, &stage)?;
                fs::rename(&backup, &destination)?;
            }
            _ => return Err(invalid()),
        }
    } else {
        match (staged, installed) {
            (true, false) => {}
            (false, true) => fs::rename(&destination, &stage)?,
            _ => return Err(invalid()),
        }
    }
    Ok(())
}
pub(super) fn finish(journal: &Journal, payload: &Payload) -> Result<(), LocalResourceError> {
    let (_, _, backup) = paths(journal, payload)?;
    if paths_io::directory(&backup)? {
        paths_io::check_tree(&backup)?;
        fs::remove_dir_all(backup)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests;
