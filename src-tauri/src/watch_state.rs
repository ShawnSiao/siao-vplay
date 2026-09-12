use crate::{
    commands::CommandError,
    domain::Project,
    store::{ProjectStore, StoreError},
};
use rusqlite::params;

impl ProjectStore {
    pub(crate) fn set_project_watched(
        &self,
        project_id: &str,
        watched: bool,
    ) -> Result<Project, StoreError> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| StoreError::Validation(error.to_string()))?
            .as_millis() as i64;
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE playback_states SET completed_at_ms = CASE WHEN ?2 THEN COALESCE(completed_at_ms, ?3) ELSE NULL END, updated_at_ms = ?3 WHERE project_id = ?1",
            params![project_id, watched, timestamp],
        )?;
        if changed == 0 {
            return Err(StoreError::ProjectNotFound(project_id.to_owned()));
        }
        transaction.execute(
            "UPDATE projects SET updated_at_ms = ?2 WHERE id = ?1",
            params![project_id, timestamp],
        )?;
        transaction.commit()?;
        self.get_project(project_id)
    }
}

#[tauri::command]
pub(crate) async fn set_project_watched(
    store: tauri::State<'_, ProjectStore>,
    project_id: String,
    watched: bool,
) -> Result<Project, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .set_project_watched(&project_id, watched)
            .map_err(CommandError::from)
    })
    .await
    .map_err(|error| CommandError {
        code: "watch_state_failed",
        message: error.to_string(),
    })?
}

#[cfg(test)]
mod tests {
    use crate::{
        domain::{SubtitleDisplayMode, UpdatePlaybackStateInput},
        understanding::test_fixture::Fixture,
    };

    #[test]
    fn legacy_playback_payload_does_not_change_completion() {
        let input: UpdatePlaybackStateInput = serde_json::from_value(serde_json::json!({
            "projectId": "legacy", "positionMs": 9000, "durationMs": 10000,
            "volume": 1, "playbackRate": 1, "subtitleMode": "original"
        }))
        .unwrap();
        assert_eq!(input.completed, None);
    }
    #[test]
    fn explicit_completion_and_correction_preserve_position_and_subtitles() {
        let fixture = Fixture::new();
        let save = |completed| {
            fixture
                .store
                .update_playback_state(UpdatePlaybackStateInput {
                    project_id: fixture.project_id.clone(),
                    position_ms: 9000,
                    duration_ms: Some(10000),
                    volume: 0.7,
                    playback_rate: 1.25,
                    subtitle_mode: SubtitleDisplayMode::Bilingual,
                    completed,
                })
                .unwrap()
        };
        assert!(save(None).playback_state.completed_at_ms.is_none());
        let completed = save(Some(true)).playback_state.completed_at_ms.unwrap();
        assert_eq!(save(None).playback_state.completed_at_ms, Some(completed));
        let corrected = fixture
            .store
            .set_project_watched(&fixture.project_id, false)
            .unwrap();
        assert_eq!(corrected.playback_state.position_ms, 9000);
        assert_eq!(corrected.playback_state.completed_at_ms, None);
        assert_eq!(save(None).playback_state.completed_at_ms, None);
        assert!(
            fixture
                .store
                .set_project_watched(&fixture.project_id, true)
                .unwrap()
                .playback_state
                .completed_at_ms
                .is_some()
        );
        let connection = fixture.store.connect().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM subtitle_segments", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            4
        );
    }
}
