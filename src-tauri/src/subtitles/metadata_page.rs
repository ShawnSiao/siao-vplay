use super::{SubtitleError, metadata::{SubtitleVersionMetadata, read_metadata_window}};
use crate::{commands::CommandError, store::ProjectStore};
use serde::{Deserialize, Serialize};
use tauri::State;

const PAGE_SIZE: usize = 24;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MetadataPageInput {
    pub project_id: String,
    pub offset: i64,
    pub expected_snapshot_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct SubtitleMetadataPage {
    pub project_id: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub offset: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub total_count: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub next_offset: Option<i64>,
    #[cfg_attr(test, schemars(length(min = 64, max = 64)))]
    pub snapshot_token: String,
    #[cfg_attr(test, schemars(length(max = 24)))]
    pub items: Vec<SubtitleVersionMetadata>,
}

pub(super) fn page_with_checkpoint(store: &ProjectStore, input: MetadataPageInput, checkpoint: impl FnOnce()) -> Result<SubtitleMetadataPage, SubtitleError> {
    if !(0..=9007199254740991).contains(&input.offset) || (input.offset > 0 && input.expected_snapshot_token.is_none()) {
        return Err(SubtitleError::InvalidRevision("请重新读取字幕历史".into()));
    }
    let mut connection = store.connect()?;
    let transaction = connection.transaction()?;
    let exists: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)", [&input.project_id], |row| row.get(0))?;
    if !exists { return Err(crate::store::StoreError::ProjectNotFound(input.project_id).into()); }
    let (snapshot_token, total_count) = super::metadata_snapshot::catalog(&transaction, &input.project_id)?;
    if input.expected_snapshot_token.as_ref().is_some_and(|expected| expected != &snapshot_token) {
        return Err(SubtitleError::VersionChanged);
    }
    checkpoint();
    let items = read_metadata_window(&transaction, &input.project_id, Some((input.offset as usize, PAGE_SIZE)))?;
    let loaded = input.offset + items.len() as i64;
    transaction.commit()?;
    Ok(SubtitleMetadataPage { project_id: input.project_id, offset: input.offset, total_count,
        next_offset: (loaded < total_count).then_some(loaded), snapshot_token, items })
}

#[tauri::command]
pub(crate) async fn list_subtitle_metadata_page(store: State<'_, ProjectStore>, input: MetadataPageInput) -> Result<SubtitleMetadataPage, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || page_with_checkpoint(&store, input, || {}).map_err(CommandError::from))
        .await.map_err(CommandError::background_task_failed)?
}
