use super::{Project, ProjectStore, StoreError, UpdatePlaybackStateInput};
use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Debug, Default)]
pub(super) struct Registry(Mutex<HashMap<String, Arc<Mutex<Session>>>>);
#[derive(Debug, Default)]
struct Session {
    token: String,
    sequence: u64,
}
fn poisoned<T>(_: std::sync::PoisonError<T>) -> SaveError {
    StoreError::Validation("播放保存会话不可用，请重新打开应用".into()).into()
}
impl Registry {
    pub(super) fn retire(&self, id: &str) {
        // Removing the map owner never destroys entries held by admitted work.
        // Deleted project IDs are not reused; SQLite still rejects any late write.
        self.0.lock().unwrap_or_else(|error| error.into_inner()).remove(id);
    }
    fn entry(&self, id: &str, create: bool) -> Result<Arc<Mutex<Session>>, SaveError> {
        let mut entries = self.0.lock().map_err(poisoned)?;
        if create {
            Ok(entries.entry(id.into()).or_default().clone())
        } else {
            entries.get(id).cloned().ok_or(SaveError::StaleSession)
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum SaveError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("播放会话已失效")]
    StaleSession,
    #[error("播放保存序号已失效")]
    StaleSequence,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveInput {
    pub session_id: String,
    pub save_sequence: u64,
    #[serde(flatten)]
    pub state: UpdatePlaybackStateInput,
}

impl ProjectStore {
    pub(crate) fn begin_playback_session(&self, project_id: &str) -> Result<String, SaveError> {
        super::validate_project_id(project_id)?;
        // Reject missing projects before allocating a registry entry.
        self.get_project(project_id)?;
        let entry = self.playback_sessions.entry(project_id, true)?;
        let mut session = entry.lock().map_err(poisoned)?;
        if let Err(error) = self.get_project(project_id) {
            if matches!(error, StoreError::ProjectNotFound(_)) {
                self.playback_sessions.retire(project_id);
            }
            return Err(error.into());
        }
        session.token = uuid::Uuid::new_v4().to_string();
        session.sequence = 0;
        Ok(session.token.clone())
    }
    pub(crate) fn save_playback_session(&self, input: SaveInput) -> Result<Project, SaveError> {
        if !(1..=9_007_199_254_740_991).contains(&input.save_sequence) {
            return Err(StoreError::Validation("播放保存序号无效".into()).into());
        }
        super::validate_project_id(&input.state.project_id)?;
        let entry = self
            .playback_sessions
            .entry(&input.state.project_id, false)?;
        let mut session = entry.lock().map_err(poisoned)?;
        if session.token.is_empty() || session.token != input.session_id {
            return Err(SaveError::StaleSession);
        }
        if input.save_sequence <= session.sequence {
            return Err(SaveError::StaleSequence);
        }
        // Keep admission through the transaction; failed writes do not consume a sequence.
        let project = self.update_playback_state(input.state)?;
        session.sequence = input.save_sequence;
        Ok(project)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{CreateLocalProjectInput, SubtitleDisplayMode};
    fn fixture() -> (tempfile::TempDir, ProjectStore, String) {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.mp4");
        std::fs::write(&path, b"isolated metadata fixture").unwrap();
        let store = ProjectStore::open(temp.path().join("siaovplay.db")).unwrap();
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: path.to_string_lossy().into_owned(),
                title: None,
            })
            .unwrap();
        (temp, store, project.id)
    }
    #[test]
    fn activation_waits_for_same_project_admission_lock() {
        let (_temp, store, id) = fixture();
        let old_token = store.begin_playback_session(&id).unwrap();
        let entry = store.playback_sessions.entry(&id, false).unwrap();
        let held = entry.lock().unwrap();
        let cloned = store.clone();
        let project = id.clone();
        let (started, ready) = std::sync::mpsc::channel();
        let (send, receive) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            started.send(()).unwrap();
            send.send(cloned.begin_playback_session(&project)).unwrap();
        });
        ready.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert!(receive.recv_timeout(std::time::Duration::from_millis(50)).is_err());
        drop(held);
        let new_token = receive.recv_timeout(std::time::Duration::from_secs(5)).unwrap().unwrap();
        worker.join().unwrap();
        assert_ne!(old_token, new_token);
        assert!(matches!(store.save_playback_session(input(&id, &old_token, 1, 100)), Err(SaveError::StaleSession)));
    }
    #[test]
    fn deletion_removes_registry_owner_and_late_save_cannot_restore_project() {
        let (temp, store, id) = fixture();
        let token = store.begin_playback_session(&id).unwrap();
        let held_entry = store.playback_sessions.entry(&id, false).unwrap();
        assert!(store.delete_project_with_remote_media_root(&id, temp.path()).unwrap().deleted);
        assert!(matches!(store.playback_sessions.entry(&id, false), Err(SaveError::StaleSession)));
        assert!(held_entry.lock().is_ok());
        assert!(store.save_playback_session(input(&id, &token, 1, 100)).is_err());
        assert!(store.begin_playback_session(&id).is_err());
        assert!(matches!(store.get_project(&id), Err(StoreError::ProjectNotFound(_))));
    }
    fn input(id: &str, token: &str, sequence: u64, position: i64) -> SaveInput {
        SaveInput {
            session_id: token.into(),
            save_sequence: sequence,
            state: UpdatePlaybackStateInput {
                project_id: id.into(),
                position_ms: position,
                duration_ms: Some(10000),
                completed: None,
                volume: 1.0,
                playback_rate: 1.0,
                subtitle_mode: SubtitleDisplayMode::Bilingual,
            },
        }
    }
    #[test]
    fn rejects_late_and_duplicate_saves_without_changing_position() {
        let (_temp, store, id) = fixture();
        let token = store.begin_playback_session(&id).unwrap();
        store
            .save_playback_session(input(&id, &token, 2, 200))
            .unwrap();
        for seq in [1, 2] {
            assert!(matches!(
                store.save_playback_session(input(&id, &token, seq, 100)),
                Err(SaveError::StaleSequence)
            ));
        }
        assert_eq!(
            store.get_project(&id).unwrap().playback_state.position_ms,
            200
        );
    }
    #[test]
    fn new_session_retires_old_token_across_store_clones() {
        let (_temp, store, id) = fixture();
        let old = store.begin_playback_session(&id).unwrap();
        let cloned = store.clone();
        let new = cloned.begin_playback_session(&id).unwrap();
        assert!(matches!(
            store.save_playback_session(input(&id, &old, 100, 100)),
            Err(SaveError::StaleSession)
        ));
        cloned
            .save_playback_session(input(&id, &new, 1, 300))
            .unwrap();
        assert_eq!(
            store.get_project(&id).unwrap().playback_state.position_ms,
            300
        );
    }
    #[test]
    fn failed_write_can_retry_same_sequence() {
        let (_temp, store, id) = fixture();
        let token = store.begin_playback_session(&id).unwrap();
        store.connect().unwrap().execute_batch("CREATE TRIGGER fail_save BEFORE UPDATE ON playback_states BEGIN SELECT RAISE(ABORT, 'isolated failure'); END;").unwrap();
        assert!(matches!(
            store.save_playback_session(input(&id, &token, 1, 100)),
            Err(SaveError::Store(StoreError::Database(_)))
        ));
        store
            .connect()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_save;")
            .unwrap();
        store
            .save_playback_session(input(&id, &token, 1, 200))
            .unwrap();
        assert_eq!(
            store.get_project(&id).unwrap().playback_state.position_ms,
            200
        );
    }
    #[test]
    fn restart_rejects_old_token_and_preserves_saved_position() {
        let (_temp, store, id) = fixture();
        let token = store.begin_playback_session(&id).unwrap();
        store
            .save_playback_session(input(&id, &token, 1, 250))
            .unwrap();
        let restarted = ProjectStore::open(store.database_path()).unwrap();
        assert!(matches!(
            restarted.save_playback_session(input(&id, &token, 2, 500)),
            Err(SaveError::StaleSession)
        ));
        assert_eq!(
            restarted
                .get_project(&id)
                .unwrap()
                .playback_state
                .position_ms,
            250
        );
    }
    #[test]
    fn token_cannot_write_another_project_and_sequence_must_be_safe() {
        let (_temp, store, id) = fixture();
        let token = store.begin_playback_session(&id).unwrap();
        let other = store
            .create_local_project(CreateLocalProjectInput {
                media_path: store.get_project(&id).unwrap().media_source.locator,
                title: None,
            })
            .unwrap()
            .id;
        store.begin_playback_session(&other).unwrap();
        assert!(matches!(
            store.save_playback_session(input(&other, &token, 1, 100)),
            Err(SaveError::StaleSession)
        ));
        for seq in [0, 9_007_199_254_740_992] {
            assert!(
                store
                    .save_playback_session(input(&id, &token, seq, 100))
                    .is_err()
            );
        }
        store
            .save_playback_session(input(&id, &token, 1, 100))
            .unwrap();
        store
            .save_playback_session(input(&id, &token, 2, 200))
            .unwrap();
        assert_eq!(
            store.get_project(&id).unwrap().playback_state.position_ms,
            200
        );
    }
    #[test]
    fn identity_is_required_when_deserializing_save_input() {
        let (_temp, _store, id) = fixture();
        let mut value = serde_json::json!({"projectId": id, "positionMs": 0, "durationMs": null,
            "volume": 1, "playbackRate": 1, "subtitleMode": "bilingual"});
        assert!(serde_json::from_value::<SaveInput>(value.clone()).is_err());
        value["sessionId"] = serde_json::json!("token");
        assert!(serde_json::from_value::<SaveInput>(value.clone()).is_err());
        value["saveSequence"] = serde_json::json!(-1);
        assert!(serde_json::from_value::<SaveInput>(value).is_err());
    }
    #[test]
    fn result_read_failure_rolls_back_before_sequence_is_consumed() {
        let (_temp, store, id) = fixture();
        let token = store.begin_playback_session(&id).unwrap();
        store.connect().unwrap().execute_batch("CREATE TRIGGER corrupt_result AFTER UPDATE ON playback_states BEGIN UPDATE projects SET created_at_ms = 'invalid' WHERE id = NEW.project_id; END;").unwrap();
        assert!(
            store
                .save_playback_session(input(&id, &token, 1, 100))
                .is_err()
        );
        store
            .connect()
            .unwrap()
            .execute_batch("DROP TRIGGER corrupt_result;")
            .unwrap();
        assert_eq!(
            store.get_project(&id).unwrap().playback_state.position_ms,
            0
        );
        store
            .save_playback_session(input(&id, &token, 1, 200))
            .unwrap();
    }
    #[test]
    fn project_locks_are_shared_by_clones_and_independent_between_projects() {
        let (_temp, store, id) = fixture();
        store.begin_playback_session(&id).unwrap();
        let entry = store.playback_sessions.entry(&id, false).unwrap();
        let clone = store.clone();
        assert!(Arc::ptr_eq(
            &entry,
            &clone.playback_sessions.entry(&id, false).unwrap()
        ));
        let other = store
            .create_local_project(CreateLocalProjectInput {
                media_path: store.get_project(&id).unwrap().media_source.locator,
                title: None,
            })
            .unwrap()
            .id;
        let held = entry.lock().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let worker =
            std::thread::spawn(move || send.send(clone.begin_playback_session(&other)).unwrap());
        receive
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap()
            .unwrap();
        drop(held);
        worker.join().unwrap();
    }
}
