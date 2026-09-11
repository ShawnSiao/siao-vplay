use super::{LibraryHome, MediaSummary};
use crate::commands::CommandError;
use std::path::Path;
use tauri::{AppHandle, Manager};

pub(super) fn allow_home_posters(app: &AppHandle, home: &LibraryHome) -> Result<(), CommandError> {
    for poster_path in home
        .collections
        .iter()
        .filter_map(|summary| summary.collection.poster_path.as_deref())
    {
        allow_poster(app, poster_path)?;
    }
    allow_media_posters(app, &home.continue_watching)?;
    allow_media_posters(app, &home.unclassified)?;
    allow_media_posters(app, &home.recently_added)
}

pub(super) fn allow_media_posters(
    app: &AppHandle,
    media: &[MediaSummary],
) -> Result<(), CommandError> {
    for poster_path in media.iter().filter_map(|item| item.poster_path.as_deref()) {
        allow_poster(app, poster_path)?;
    }
    Ok(())
}

pub(super) fn allow_poster(app: &AppHandle, poster_path: &str) -> Result<(), CommandError> {
    if !Path::new(poster_path).is_file() {
        return Ok(());
    }
    app.asset_protocol_scope()
        .allow_file(poster_path)
        .map_err(|error| {
            CommandError::asset_scope_failed(format!("无法授权媒体库读取视频封面：{error}"))
        })
}
