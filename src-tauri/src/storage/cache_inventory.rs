use super::StorageError;
use rusqlite::{Connection, OpenFlags};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

// The database records generated files; directory membership alone is not ownership.
pub(super) fn clear_recorded_cache(database: &Path, root: &Path) -> Result<u64, StorageError> {
    let connection = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut sources = HashSet::new();
    let mut statement = connection.prepare("SELECT locator FROM media_sources")?;
    for locator in statement.query_map([], |row| row.get::<_, String>(0))? {
        let locator = locator?;
        sources.insert(dunce::canonicalize(&locator).unwrap_or_else(|_| PathBuf::from(locator)));
    }
    drop(statement);
    let mut statement = connection.prepare(
        "SELECT project_id, poster_path, source_sha256, 'poster' FROM media_sources WHERE poster_path IS NOT NULL
         UNION ALL SELECT project_id, path, source_sha256, 'playback' FROM media_artifacts WHERE kind = 'playback_proxy'"
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        let (project, path, hash, kind) = row?;
        let Some(hash) = hash else {
            continue;
        };
        if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            continue;
        }
        let project_path = Path::new(&project);
        if project_path.components().count() != 1
            || !matches!(project_path.components().next(), Some(Component::Normal(_)))
        {
            continue;
        }
        let extension = if kind == "poster" { "jpg" } else { "mp4" };
        let expected = root
            .join(&project)
            .join(format!("{kind}-{}.{}", &hash[..16], extension));
        // Reject arbitrary stored paths, including paths outside this cache location.
        if Path::new(&path) != expected || !seen.insert(path.clone()) {
            continue;
        }
        let Some(_) = ordinary_cache_file(&expected, root)? else {
            continue;
        };
        let canonical = dunce::canonicalize(&expected)?;
        if sources.contains(&canonical) {
            continue;
        }
        entries.push(path);
    }
    drop(statement);
    drop(connection);
    let mut reclaimed = 0_u64;
    for path in entries {
        // Recheck before each operation; never recurse through an unowned directory.
        let Some(metadata) = ordinary_cache_file(Path::new(&path), root)? else {
            continue;
        };
        fs::remove_file(&path)?;
        super::database::clear_cache_references(database, &path)?;
        reclaimed = reclaimed.saturating_add(metadata.len());
    }
    Ok(reclaimed)
}

fn ordinary_cache_file(path: &Path, root: &Path) -> Result<Option<fs::Metadata>, StorageError> {
    let Some(parent) = path.parent() else {
        return Ok(None);
    };
    for candidate in [parent, path] {
        let metadata = match fs::symlink_metadata(candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if metadata.is_symlink() || is_reparse(&metadata) {
            return Ok(None);
        }
    }
    if dunce::canonicalize(parent)?.parent() != Some(root) {
        return Ok(None);
    }
    let metadata = fs::symlink_metadata(path)?;
    Ok(metadata.is_file().then_some(metadata))
}

#[cfg(windows)]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn is_reparse(_: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
#[path = "cache_inventory_tests.rs"]
mod tests;
