use std::{collections::BTreeMap, io, ops::{Deref, DerefMut}, path::{Path, PathBuf}, sync::{Arc, Mutex, OnceLock, Weak}};
use rusqlite::Connection;

#[derive(Debug, Default)]
struct State { connections: usize, exclusive: bool }
#[derive(Debug, Default)]
struct Gate(Mutex<State>);
fn gate(path: &Path) -> io::Result<Arc<Gate>> {
    static GATES: OnceLock<Mutex<BTreeMap<PathBuf, Weak<Gate>>>> = OnceLock::new();
    let key = if path.exists() { dunce::canonicalize(path)? } else {
        dunce::canonicalize(path.parent().ok_or_else(|| io::Error::other("数据库目录缺失"))?)?.join(path.file_name().ok_or_else(|| io::Error::other("数据库文件名缺失"))?)
    };
    let mut gates = GATES.get_or_init(Default::default).lock().map_err(|_| io::Error::other("数据库访问状态不可用"))?;
    gates.retain(|_, value| value.strong_count() > 0);
    let entry = gates.entry(key).or_default();
    if let Some(gate) = entry.upgrade() { return Ok(gate); }
    let gate = Arc::new(Gate::default());
    *entry = Arc::downgrade(&gate);
    Ok(gate)
}
fn busy() -> io::Error { io::Error::new(io::ErrorKind::WouldBlock, "项目数据库暂不可访问，请稍后重试；如应用数据迁移已完成，请先重启") }

#[derive(Debug)]
pub(crate) struct Exclusive(Arc<Gate>);
impl Drop for Exclusive {
    fn drop(&mut self) { self.0.0.lock().unwrap_or_else(|e| e.into_inner()).exclusive = false; }
}
pub(crate) fn exclusive(path: &Path) -> io::Result<Exclusive> {
    let gate = gate(path)?;
    {
        let mut state = gate.0.lock().map_err(|_| io::Error::other("数据库访问状态不可用"))?;
        if state.exclusive || state.connections > 0 { return Err(busy()); }
        state.exclusive = true;
    }
    Ok(Exclusive(gate))
}
struct Reader(Arc<Gate>);
impl Drop for Reader {
    fn drop(&mut self) { self.0.0.lock().unwrap_or_else(|e| e.into_inner()).connections -= 1; }
}
pub(crate) struct GuardedConnection {
    connection: Connection,
    _reader: Reader,
}
impl Deref for GuardedConnection { type Target = Connection; fn deref(&self) -> &Connection { &self.connection } }
impl DerefMut for GuardedConnection { fn deref_mut(&mut self) -> &mut Connection { &mut self.connection } }
pub(crate) fn connect(path: &Path) -> Result<GuardedConnection, crate::store::StoreError> {
    let gate = gate(path)?;
    {
        let mut state = gate.0.lock().map_err(|_| io::Error::other("数据库访问状态不可用"))?;
        if state.exclusive { return Err(busy().into()); }
        state.connections += 1;
    }
    let reader = Reader(gate);
    let connection = Connection::open(path)?;
    Ok(GuardedConnection { connection, _reader: reader })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{store::ProjectStore, domain::CreateLocalProjectInput};
    #[test]
    fn migration_gate_prevents_new_project_writes() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("data.db");
        let store = ProjectStore::open(&database).unwrap();
        let media = directory.path().join("local.mp4");
        std::fs::write(&media, b"retain").unwrap();
        let owner = exclusive(&database).unwrap();
        let input = || CreateLocalProjectInput { media_path: media.to_string_lossy().into_owned(), title: None };
        assert!(store.create_local_project(input()).is_err());
        drop(owner);
        assert!(store.list_projects().unwrap().is_empty());
        assert!(store.create_local_project(input()).is_ok());
    }
}

#[cfg(test)]
mod lifetime_tests {
    use super::*;
    use crate::store::ProjectStore;
    #[test]
    fn existing_connection_blocks_migration_and_path_aliases_share_gate() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("data.db");
        let store = ProjectStore::open(&database).unwrap();
        let reader = store.connect().unwrap();
        assert!(exclusive(&database).is_err());
        drop(reader);
        let owner = exclusive(&database).unwrap();
        assert!(ProjectStore::open(directory.path().join(".").join("data.db")).is_err());
        assert!(ProjectStore::open(directory.path().join("unrelated.db")).is_ok());
        drop(owner);
        assert!(store.connect().is_ok());
    }
}
