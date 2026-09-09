use super::*;
use std::fs::{Metadata, OpenOptions};

pub(super) fn metadata(path: &Path) -> Result<Option<Metadata>, LocalResourceError> {
    match fs::symlink_metadata(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}
fn linked(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
pub(super) fn contained(root: &Path, relative: &str) -> Result<PathBuf, LocalResourceError> {
    let relative = safe_relative_path(relative, "资源删除路径")?;
    if !directory(root)? {
        return Err(invalid());
    }
    let mut path = root.to_path_buf();
    let components: Vec<_> = relative.components().collect();
    for (index, component) in components.iter().enumerate() {
        path.push(component.as_os_str());
        if let Some(meta) = metadata(&path)? {
            if linked(&meta) || (index + 1 < components.len() && !meta.is_dir()) {
                return Err(invalid());
            }
        }
    }
    Ok(path)
}
pub(super) fn directory(path: &Path) -> Result<bool, LocalResourceError> {
    match metadata(path)? {
        None => Ok(false),
        Some(meta) if meta.is_dir() && !linked(&meta) => Ok(true),
        Some(_) => Err(invalid()),
    }
}
pub(super) fn check_tree(path: &Path) -> Result<(), LocalResourceError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let meta = fs::symlink_metadata(entry.path())?;
        if linked(&meta) {
            return Err(invalid());
        }
        if meta.is_dir() {
            check_tree(&entry.path())?;
        } else if !meta.is_file() {
            return Err(invalid());
        }
    }
    Ok(())
}
pub(super) fn check_record(path: &Path) -> Result<(), LocalResourceError> {
    for candidate in [
        path.to_path_buf(),
        path.with_extension("json.part"),
        path.with_extension("json.bak"),
    ] {
        if let Some(meta) = metadata(&candidate)? {
            if !meta.is_file() || linked(&meta) {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
pub(super) fn prepare(path: &Path, journal: &Journal) -> Result<(), LocalResourceError> {
    validate(journal)?;
    for candidate in [path.to_path_buf(), path.with_extension("json.bak")] {
        if metadata(&candidate)?.is_some() {
            return Err(invalid());
        }
    }
    let bytes = serde_json::to_vec_pretty(journal)?;
    let part = path.with_extension("json.part");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part)?;
    let result = file.write_all(&bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result.and_then(|()| fs::rename(&part, path)) {
        if let Err(cleanup) = fs::remove_file(&part) {
            return Err(io::Error::other(format!(
                "删除日志写入失败且临时文件未清理：{error}；{cleanup}"
            ))
            .into());
        }
        return Err(error.into());
    }
    Ok(())
}
