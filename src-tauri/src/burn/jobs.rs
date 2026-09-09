use super::*;

pub(super) fn run_job(
    store: &ProjectStore,
    job_id: &str,
    cancellation: &AtomicBool,
) -> Result<(), SubtitleBurnError> {
    check_cancelled(store, job_id, cancellation)?;
    let _admission = crate::task_admission::acquire(crate::task_admission::Kind::SubtitleBurn,
        || cancellation.load(Ordering::SeqCst)).map_err(|error| {
            if error.kind() == std::io::ErrorKind::Interrupted { SubtitleBurnError::Cancelled }
            else { SubtitleBurnError::BurnFailed(error.to_string()) }
        })?;
    check_cancelled(store, job_id, cancellation)?;
    let _resources = crate::resource_leases::configured(&["ffmpeg-cpu"])?;
    transition_job(store, job_id, "queued", "running", "verifying", 0.02)?;
    let job = load_stored_job(store, job_id)?;
    let media_path = validate_baseline(store, &job)?;
    verify_runtime(&job)?;
    verify_subtitle(&job)?;
    let media_probe = media::validate_media_path(&media_path)?;
    check_cancelled(store, job_id, cancellation)?;
    if job.intended_output_path.exists() || job.intended_manifest_path.exists() {
        return Err(SubtitleBurnError::BurnFailed(
            "目标文件已经存在，请重新开始烧录".to_owned(),
        ));
    }
    remove_file_if_present(&job.temporary_output_path)?;
    remove_file_if_present(&temporary_manifest_path(&job))?;
    update_running_progress(store, job_id, "burning", 0.05)?;

    let job_directory = job_directory(store, &job.public.project_id, &job.public.id)?;
    let log_path = job_directory.join("ffmpeg.log");
    let progress_path = job_directory.join("progress.txt");
    remove_file_if_present(&progress_path)?;
    let subtitle_file_name = job
        .subtitle_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| SubtitleBurnError::BurnFailed("临时字幕文件名无效".to_owned()))?;
    let filter = format!(
        "subtitles={subtitle_file_name}:force_style='{}'",
        subtitle_force_style(job.style)
    );
    let mut command = hidden_command(&job.runtime_path);
    command
        .current_dir(&job_directory)
        .args([
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "warning",
            "-n",
            "-i",
        ])
        .arg(&media_path)
        .args(["-map", "0:v:0", "-map", "0:a?", "-vf"])
        .arg(filter)
        .args(media::h264_video_encode_args(&media_probe))
        .args([
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-max_muxing_queue_size",
            "1024",
            "-progress",
            "progress.txt",
            "-nostats",
        ])
        .arg(&job.temporary_output_path);
    let status = run_ffmpeg(
        store,
        &job,
        cancellation,
        &mut command,
        &log_path,
        &progress_path,
    )?;
    if !status.success() {
        return Err(SubtitleBurnError::BurnFailed(read_log_tail(&log_path)));
    }
    check_cancelled(store, job_id, cancellation)?;
    transition_job(store, job_id, "running", "validating", "validating", 0.96)?;
    media::validate_media_path(&job.temporary_output_path).map_err(|error| {
        SubtitleBurnError::BurnFailed(format!("生成的视频无法通过媒体检查：{error}"))
    })?;
    let output_sha256 = hash_file(&job.temporary_output_path)?;
    let project = store.get_project(&job.public.project_id)?;
    let completed_at_ms = now_ms()?;
    let output_file_name = job
        .intended_output_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| SubtitleBurnError::BurnFailed("输出文件名无效".to_owned()))?;
    let manifest = SubtitleBurnManifest {
        format: BURN_MANIFEST_FORMAT,
        project_id: &project.id,
        project_title: &project.title,
        mode: job.public.mode,
        source_version_id: job.public.source_version_id.as_deref(),
        translation_version_id: &job.public.translation_version_id,
        source_media_sha256: &job.expected_media_sha256,
        output_file: output_file_name,
        output_file_sha256: &output_sha256,
        runtime_version: &job.public.runtime_version,
        runtime_sha256: &job.runtime_sha256,
        style: job.style,
        completed_at_ms,
    };
    let temporary_manifest_path = temporary_manifest_path(&job);
    fs::write(
        &temporary_manifest_path,
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    check_cancelled(store, job_id, cancellation)?;
    fs::rename(&job.temporary_output_path, &job.intended_output_path)?;
    if let Err(error) = fs::rename(&temporary_manifest_path, &job.intended_manifest_path) {
        let _ = fs::remove_file(&job.intended_output_path);
        return Err(error.into());
    }
    let changed = store.connect()?.execute(
        "UPDATE subtitle_burn_jobs
         SET status = 'completed', stage = 'completed', progress = 1.0,
             output_sha256 = ?2, updated_at_ms = ?3, completed_at_ms = ?3
         WHERE id = ?1 AND status = 'validating' AND cancel_requested_at_ms IS NULL",
        params![job_id, output_sha256, completed_at_ms],
    )?;
    if changed != 1 {
        let _ = fs::remove_file(&job.intended_output_path);
        let _ = fs::remove_file(&job.intended_manifest_path);
        return Err(SubtitleBurnError::InvalidJobState(
            "保存烧录完成状态时任务已经变化".to_owned(),
        ));
    }
    let _ = remove_job_directory(store, &job.public.project_id, job_id);
    Ok(())
}
