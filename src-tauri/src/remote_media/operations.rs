use super::*;

pub fn import_remote_media_url(
    store: &ProjectStore,
    remote_media_root: &Path,
    input: ImportRemoteMediaUrlInput,
) -> Result<Project, RemoteMediaError> {
    let _resources = crate::resource_leases::configured(&["ffmpeg-cpu"])?;
    let operation = ImportOperation::register(&input.operation_id)?;
    let preflight = preflight_remote_media(&input.url)?;
    operation.check()?;
    if preflight.preview.preview_token != input.expected_preview_token {
        return Err(RemoteMediaError::PreviewChanged);
    }

    let import_directory = remote_media_root.join(Uuid::new_v4().to_string());
    fs::create_dir_all(&import_directory)?;

    let result = (|| {
        let media_path = match preflight.preview.media_kind {
            RemoteMediaKind::DirectFile => {
                let extension = safe_extension(&preflight.preview.display_name)
                    .unwrap_or_else(|| "media".to_owned());
                let destination = import_directory.join(format!("source.{extension}"));
                download_direct_media(
                    &preflight.preview.original_url,
                    &preflight.preview.final_url,
                    &destination,
                    &operation.cancelled,
                )?;
                destination
            }
            RemoteMediaKind::Hls => {
                let mirror_directory = import_directory.join("hls");
                fs::create_dir_all(&mirror_directory)?;
                let local_playlist =
                    HlsMirror::new(&mirror_directory, Arc::clone(&operation.cancelled))
                        .mirror(&preflight.preview.final_url)?;
                let destination = import_directory.join("source.mkv");
                operation.check()?;
                media::remux_local_hls(&local_playlist, &destination)?;
                destination
            }
        };

        operation.check()?;
        media::validate_media_path(&media_path)?;
        operation.check()?;
        store
            .create_remote_project(
                &media_path,
                &preflight.preview.original_url,
                &preflight.preview.display_name,
                input.title.as_deref(),
            )
            .map_err(RemoteMediaError::from)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&import_directory);
    }
    result
}
