use super::super::transaction_paths::metadata;
use super::*;
use std::fs::OpenOptions;
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
