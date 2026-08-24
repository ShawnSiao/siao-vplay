use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
};

use uuid::Uuid;

use super::StorageError;

pub(crate) fn canonical_existing_directory(
    value: Option<String>,
    label: &str,
) -> Result<Option<String>, StorageError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let path = dunce::canonicalize(value)
        .map_err(|error| StorageError::InvalidPath(format!("无法读取{label}：{error}")))?;
    if !path.is_dir() {
        return Err(StorageError::InvalidPath(format!(
            "{label}不存在或不是文件夹"
        )));
    }
    verify_writable(&path, label)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

pub(crate) fn configured_path(value: Option<&str>, fallback: PathBuf) -> PathBuf {
    value.map(PathBuf::from).unwrap_or(fallback)
}

pub(crate) fn directory_available(path: &Path) -> bool {
    path.is_dir()
}

pub(crate) fn directory_size(path: &Path) -> u64 {
    let mut total = 0_u64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
    }
    total
}

pub(crate) fn available_space(path: &Path) -> Option<u64> {
    available_space_impl(path)
}

pub(crate) fn remove_remote_project_directory(root: &Path, locator: &str) -> bool {
    let Ok(root) = dunce::canonicalize(root) else {
        return false;
    };
    let Some(parent) = Path::new(locator).parent() else {
        return false;
    };
    let Ok(parent) = dunce::canonicalize(parent) else {
        return false;
    };
    parent != root && parent.starts_with(&root) && fs::remove_dir_all(parent).is_ok()
}

fn verify_writable(path: &Path, label: &str) -> Result<(), StorageError> {
    let probe = path.join(format!(".siaovplay-write-probe-{}", Uuid::new_v4()));
    let result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .and_then(|file| file.sync_all());
    let _ = fs::remove_file(&probe);
    result.map_err(|error| StorageError::InvalidPath(format!("{label}不可写：{error}")))
}

#[cfg(windows)]
fn available_space_impl(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let existing = nearest_existing_ancestor(path)?;
    let mut wide = OsStr::new(existing.as_os_str())
        .encode_wide()
        .collect::<Vec<_>>();
    wide.push(0);
    let mut available = 0_u64;
    let success = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (success != 0).then_some(available)
}

#[cfg(not(windows))]
fn available_space_impl(_path: &Path) -> Option<u64> {
    None
}

#[cfg(windows)]
fn nearest_existing_ancestor(path: &Path) -> Option<&Path> {
    path.ancestors().find(|candidate| candidate.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_size_ignores_missing_roots() {
        assert_eq!(directory_size(Path::new("Z:/missing-siaovplay-root")), 0);
    }

    #[test]
    fn canonical_directory_rejects_files() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("file.txt");
        fs::write(&file, b"data").unwrap();
        assert!(
            canonical_existing_directory(Some(file.display().to_string()), "测试位置").is_err()
        );
    }
}
