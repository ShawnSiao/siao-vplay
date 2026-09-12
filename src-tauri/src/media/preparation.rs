use super::*;

#[cfg(test)]
pub fn prepare_project_media(
    store: &ProjectStore,
    media_cache_root: &Path,
    input: PrepareProjectMediaInput,
) -> Result<MediaPreparation, MediaError> {
    prepare_project_media_controlled(store, media_cache_root, input, None)
}

pub(crate) fn prepare_project_media_controlled(
    store: &ProjectStore,
    media_cache_root: &Path,
    input: PrepareProjectMediaInput,
    control: Option<crate::preparation::Control>,
) -> Result<MediaPreparation, MediaError> {
    let runtime = MediaRuntime::resolve_controlled(control)?;
    let inspection = inspect_with_runtime(store, &input.project_id, &runtime)?;
    let project = store.get_project(&input.project_id)?;
    let source_path = PathBuf::from(&project.media_source.locator);

    if inspection.playback_gate.decision == PlaybackDecision::Unsupported {
        return Err(MediaError::MissingVideo);
    }
    let needs_proxy =
        input.force_proxy || inspection.playback_gate.decision == PlaybackDecision::ProxyRequired;
    runtime.cancel.check()?;
    if !needs_proxy {
        return Ok(MediaPreparation {
            inspection,
            playback_source_kind: PlaybackSourceKind::Original,
            playback_path: path_to_string(&source_path),
            proxy_artifact: None,
            reused_proxy: false,
        });
    }

    let (artifact, reused_proxy) = generate_playback_proxy(
        store,
        media_cache_root,
        &runtime,
        &project,
        &inspection,
        &source_path,
    )?;
    Ok(MediaPreparation {
        inspection,
        playback_source_kind: PlaybackSourceKind::Proxy,
        playback_path: artifact.path.clone(),
        proxy_artifact: Some(artifact),
        reused_proxy,
    })
}

fn generate_playback_proxy(
    store: &ProjectStore,
    media_cache_root: &Path,
    runtime: &MediaRuntime,
    project: &crate::domain::Project,
    inspection: &MediaInspection,
    source_path: &Path,
) -> Result<(MediaArtifact, bool), MediaError> {
    runtime.cancel.check()?;
    let project_cache = media_cache_root.join(&project.id);
    let fingerprint_prefix = &inspection.source_sha256[..16];
    let final_path = project_cache.join(format!("playback-{fingerprint_prefix}.mp4"));
    let temporary_path = project_cache.join(format!("playback-{fingerprint_prefix}.part.mp4"));

    if let Some(artifact) = store.find_completed_playback_proxy(
        &project.id,
        &inspection.source_sha256,
        PLAYBACK_PROXY_PROFILE,
    )? && Path::new(&artifact.path) == final_path
        && playback_proxy_is_valid(runtime, &final_path)
    {
        return Ok((artifact, true));
    }

    runtime.cancel.check()?;
    runtime.stage(crate::preparation::Stage::Queued)?;
    let _admission = crate::task_admission::acquire(crate::task_admission::Kind::PlaybackProxy,
        || runtime.cancel.check().is_err()).map_err(|error| MediaError::ProxyFailed(error.to_string()))?;
    runtime.stage(crate::preparation::Stage::Fingerprint)?;
    verify_proxy_source(source_path, &inspection.source_sha256, &runtime.cancel)?;
    fs::create_dir_all(&project_cache)?;
    let artifact = store.begin_playback_proxy(
        &project.id,
        &project.media_source.id,
        &inspection.source_sha256,
        PLAYBACK_PROXY_PROFILE,
        &final_path,
    )?;
    store.update_media_artifact_status(&artifact.id, MediaArtifactStatus::Running, None, None)?;

    remove_controlled_file_if_present(&temporary_path, &project_cache)?;
    remove_controlled_file_if_present(&final_path, &project_cache)?;
    runtime
        .stage(crate::preparation::Stage::Transcode)
        .map_err(|error| {
            fail_proxy(
                store,
                &artifact.id,
                &temporary_path,
                &project_cache,
                "user_cancelled",
                &error.to_string(),
            )
        })?;
    let mut command = hidden_command(&runtime.ffmpeg_path);
    command
        .args(["-y", "-hide_banner", "-nostdin", "-v", "error", "-i"])
        .arg(source_path)
        .args(["-map", "0:v:0", "-map", "0:a:0?"])
        .args(h264_video_encode_args(&inspection.probe))
        .args([
            "-force_key_frames",
            "expr:gte(t,n_forced*2)",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
        ])
        .arg(&temporary_path);
    let output =
        crate::cancellable_process::output(&mut command, &runtime.cancel).map_err(|error| {
            fail_proxy(
                store,
                &artifact.id,
                &temporary_path,
                &project_cache,
                if error.kind() == std::io::ErrorKind::Interrupted {
                    "user_cancelled"
                } else {
                    "ffmpeg_start_failed"
                },
                &error.to_string(),
            )
        })?;

    if !output.status.success() {
        let message = command_error_message(&output);
        return Err(fail_proxy(
            store,
            &artifact.id,
            &temporary_path,
            &project_cache,
            "ffmpeg_failed",
            &message,
        ));
    }
    runtime
        .stage(crate::preparation::Stage::Validate)
        .map_err(|error| {
            fail_proxy(
                store,
                &artifact.id,
                &temporary_path,
                &project_cache,
                "user_cancelled",
                &error.to_string(),
            )
        })?;
    if !playback_proxy_is_valid(runtime, &temporary_path) {
        return Err(fail_proxy(
            store,
            &artifact.id,
            &temporary_path,
            &project_cache,
            "proxy_validation_failed",
            "FFmpeg 已结束，但代理文件不满足 H.264 yuv420p 与 AAC MP4 门禁",
        ));
    }

    verify_proxy_source(source_path, &inspection.source_sha256, &runtime.cancel).map_err(|error| {
        fail_proxy(store, &artifact.id, &temporary_path, &project_cache,
            if runtime.cancel.check().is_err() { "user_cancelled" } else { "source_changed" }, &error.to_string())
    })?;
    runtime
        .stage(crate::preparation::Stage::Finalize)
        .map_err(|error| {
            fail_proxy(
                store,
                &artifact.id,
                &temporary_path,
                &project_cache,
                "user_cancelled",
                &error.to_string(),
            )
        })?;
    fs::rename(&temporary_path, &final_path).map_err(|error| {
        fail_proxy(
            store,
            &artifact.id,
            &temporary_path,
            &project_cache,
            "proxy_finalize_failed",
            &format!("无法完成代理文件：{error}"),
        )
    })?;
    let completed = store.update_media_artifact_status(
        &artifact.id,
        MediaArtifactStatus::Completed,
        None,
        None,
    )?;
    Ok((completed, false))
}

fn verify_proxy_source(path: &Path, expected: &str, cancel: &crate::cancellable_process::Cancellation) -> Result<(), MediaError> {
    if hash_file_controlled(path, cancel)? != expected { return Err(MediaError::SourceChanged); }
    Ok(())
}
#[cfg(test)]
#[path = "preparation_tests.rs"]
mod tests;
