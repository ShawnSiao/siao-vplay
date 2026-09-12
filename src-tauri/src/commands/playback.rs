use super::{CommandError, ProjectStore};
use crate::store::playback_sessions::SaveError;

impl From<SaveError> for CommandError {
    fn from(error: SaveError) -> Self {
        if let SaveError::Store(error) = error { return error.into(); }
        let code = match &error {
            SaveError::StaleSession => "stale_playback_session",
            SaveError::StaleSequence => "stale_playback_sequence",
            SaveError::Store(_) => unreachable!(),
        };
        Self { code, message: error.to_string() }
    }
}

#[tauri::command]
pub(crate) async fn begin_playback_session(
    store: tauri::State<'_, ProjectStore>,
    project_id: String,
) -> Result<String, CommandError> {
    super::project_io::run(store.inner().clone(), move |store| {
        store.begin_playback_session(&project_id).map_err(Into::into)
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_identity_errors_are_distinct_from_storage_errors() {
        assert_eq!(CommandError::from(SaveError::StaleSession).code, "stale_playback_session");
        assert_eq!(CommandError::from(SaveError::StaleSequence).code, "stale_playback_sequence");
        let error = crate::store::StoreError::ProjectNotFound("absent".into());
        assert_eq!(CommandError::from(SaveError::Store(error)).code, "project_not_found");
    }
}
