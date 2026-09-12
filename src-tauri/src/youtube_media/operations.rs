use super::*;

pub fn inspect_youtube_url_authorized(
    input: InspectYouTubeUrlInput,
    authorized_resolver_base: Option<String>,
) -> Result<YouTubeMediaPreview, YouTubeMediaError> {
    let _resources = crate::resource_leases::configured(&["yt-dlp", "ffmpeg-cpu"])?;
    let original = validate_public_video_page(&input.url)?;
    let tool = verify_tool(&resolve_yt_dlp_path()?)?;
    inspect_with_tool(&original, &tool, authorized_resolver_base.as_deref())
}

pub fn import_youtube_url_authorized(
    store: &ProjectStore,
    remote_media_root: &Path,
    input: ImportYouTubeUrlInput,
    authorized_resolver_base: Option<String>,
) -> Result<Project, YouTubeMediaError> {
    let _resources = crate::resource_leases::configured(&["yt-dlp", "ffmpeg-cpu"])?;
    let operation = ImportOperation::register(&input.operation_id)?;
    let original = validate_public_video_page(&input.url)?;
    operation.check()?;

    let tool = verify_tool(&resolve_yt_dlp_path()?)?;
    let refreshed = inspect_with_tool(&original, &tool, authorized_resolver_base.as_deref())?;
    operation.check()?;
    if refreshed.preview_token != input.expected_preview_token {
        return Err(YouTubeMediaError::PreviewChanged);
    }

    let import_directory = remote_media_root.join(Uuid::new_v4().to_string());
    fs::create_dir_all(&import_directory)?;
    let result = (|| {
        let download_url = refreshed
            .resolved_download_url
            .as_ref()
            .unwrap_or(&original);
        let media_path =
            download_video(download_url, &tool, &import_directory, &operation.cancelled)?;
        operation.check()?;
        let metadata = fs::metadata(&media_path)?;
        if metadata.len() > MAX_MEDIA_BYTES {
            return Err(YouTubeMediaError::SizeLimit);
        }
        media::validate_media_path(&media_path)?;
        operation.check()?;
        store
            .create_remote_project_with_provenance(
                &media_path,
                original.as_str(),
                &format!("{}.mp4", refreshed.title),
                Some(&refreshed.title),
                &RemoteImportProvenance {
                    importer: if refreshed.resolved_download_url.is_some() {
                        "yt-dlp+x-public-resolver".to_owned()
                    } else {
                        "yt-dlp".to_owned()
                    },
                    importer_version: tool.version.clone(),
                    importer_sha256: tool.sha256.clone(),
                },
            )
            .map_err(YouTubeMediaError::from)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&import_directory);
    }
    result
}

#[cfg(test)]
pub fn inspect_youtube_url(
    input: InspectYouTubeUrlInput,
) -> Result<YouTubeMediaPreview, YouTubeMediaError> {
    inspect_youtube_url_authorized(input, None)
}
#[cfg(test)]
pub fn import_youtube_url(
    store: &ProjectStore,
    root: &Path,
    input: ImportYouTubeUrlInput,
) -> Result<Project, YouTubeMediaError> {
    import_youtube_url_authorized(store, root, input, None)
}
