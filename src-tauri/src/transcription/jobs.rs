use super::*;

pub(crate) fn run_job(
    store: &ProjectStore,
    job_id: &str,
    cancellation: &AtomicBool,
) -> Result<(), TranscriptionError> {
    let job = load_stored_job(store, job_id)?;
    let model_id = format!("whisper-model-{}", job.public.model_kind.as_str());
    let _resources = crate::resource_leases::configured(&[
        "ffmpeg-cpu",
        "whisper-cpu",
        "whisper-vad-silero-6.2",
        &model_id,
    ])?;
    if job.public.status.as_str() != "queued" {
        return Err(TranscriptionError::InvalidJobState(job.public.status.as_str().to_owned()));
    }
    if job.cancel_requested_at_ms.is_some() || cancellation.load(Ordering::SeqCst) {
        return Err(TranscriptionError::Cancelled);
    }
    transition_job(
        store,
        job_id,
        "queued",
        "extracting",
        "extracting_audio",
        0.05,
    )?;
    let media_path = validate_baseline(store, &job)?;
    let (mut runtime, model, mut vad_model) = verify_job_assets(&job)?;
    let work_directory = reset_job_directory(store, job_id)?;
    let audio_path = work_directory.join("audio-16khz-mono.wav");
    let ffmpeg_log = work_directory.join("ffmpeg.log");
    let ffmpeg_path = media::ffmpeg_path()?;
    let mut extraction = hidden_command(&ffmpeg_path);
    extraction
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
        .arg(&media_path)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
        ])
        .arg(&audio_path);
    let extraction_status = run_child(store, job_id, cancellation, &mut extraction, &ffmpeg_log)?;
    if !extraction_status.success()
        || fs::metadata(&audio_path)
            .map(|metadata| metadata.len() <= 44)
            .unwrap_or(true)
    {
        return Err(TranscriptionError::AudioExtractionFailed(read_log_tail(
            &ffmpeg_log,
        )));
    }

    check_cancelled(store, job_id, cancellation)?;
    transition_job(
        store,
        job_id,
        "extracting",
        "transcribing",
        "transcribing",
        0.3,
    )?;
    let output_prefix = work_directory.join("whisper-result");
    let mut whisper_log = work_directory.join("whisper-vulkan.log");
    let mut transcription_status = run_whisper(
        store,
        job_id,
        cancellation,
        &runtime,
        &model,
        vad_model.as_ref(),
        &audio_path,
        job.public.language_code.as_str(),
        &output_prefix,
        &whisper_log,
    )?;
    if !transcription_status.success() && runtime.backend == "vulkan" {
        check_cancelled(store, job_id, cancellation)?;
        let cpu_runtime = verify_runtime("cpu")?;
        if !cpu_runtime.vad_timeline_verified {
            vad_model = None;
        }
        let parameters_json =
            transcription_parameters(job.public.language_code.as_str(), &cpu_runtime, vad_model.as_ref())?;
        update_job_runtime(store, job_id, &cpu_runtime, &parameters_json)?;
        runtime = cpu_runtime;
        let _ = fs::remove_file(output_prefix.with_extension("json"));
        whisper_log = work_directory.join("whisper-cpu.log");
        transcription_status = run_whisper(
            store,
            job_id,
            cancellation,
            &runtime,
            &model,
            vad_model.as_ref(),
            &audio_path,
            job.public.language_code.as_str(),
            &output_prefix,
            &whisper_log,
        )?;
    }
    let output_path = output_prefix.with_extension("json");
    if !transcription_status.success() || !output_path.is_file() {
        return Err(TranscriptionError::TranscriptionFailed(read_log_tail(
            &whisper_log,
        )));
    }

    check_cancelled(store, job_id, cancellation)?;
    transition_job(
        store,
        job_id,
        "transcribing",
        "validating",
        "validating_output",
        0.85,
    )?;
    let output_hash = hash_file(&output_path)?;
    let parsed = parse_whisper_output(
        &output_path,
        job.public.language_code.as_str(),
        job.media_duration_ms,
    )?;
    let report = subtitles::inspect_generated_cues(&parsed.cues, Some(job.media_duration_ms));
    if report.error_count > 0 {
        return Err(TranscriptionError::InvalidOutput(format!(
            "字幕预检包含 {} 项错误",
            report.error_count
        )));
    }
    check_cancelled(store, job_id, cancellation)?;
    validate_baseline(store, &job)?;
    let version = subtitles::persist_transcription(
        store,
        PersistTranscriptionInput {
            project_id: job.public.project_id.clone(),
            source_label: format!("本地字幕识别 · {}", model.kind.product_label()),
            source_sha256: output_hash,
            language_code: parsed.language_code,
            expected_project_revision: job.expected_project_revision,
            expected_media_sha256: job.expected_media_sha256.clone(),
            media_duration_ms: Some(job.media_duration_ms),
            cues: parsed.cues,
        },
    )?;
    let timestamp = now_ms()?;
    let changed = store.connect()?.execute(
        "UPDATE transcription_jobs
         SET status = 'completed', stage = 'completed', progress = 1.0,
             subtitle_version_id = ?2, error_code = NULL, error_message = NULL,
             cancel_requested_at_ms = NULL,
             updated_at_ms = ?3, completed_at_ms = ?3
         WHERE id = ?1 AND status = 'validating'",
        params![job_id, version.id, timestamp],
    )?;
    if changed != 1 {
        return Err(TranscriptionError::InvalidJobState(
            "完成写入时任务状态已变化".to_owned(),
        ));
    }
    remove_job_directory(store, job_id)?;
    Ok(())
}
