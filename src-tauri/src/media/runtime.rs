use super::*;

#[derive(Clone, Debug)]
pub(super) struct MediaRuntime {
    pub(super) ffmpeg_path: PathBuf,
    pub(super) ffprobe_path: PathBuf,
    pub(super) version: String,
    pub(super) cancel: crate::cancellable_process::Cancellation,
    control: Option<crate::preparation::Control>,
    _lease: crate::resource_usage::ResourceLease,
}

impl MediaRuntime {
    pub(super) fn resolve() -> Result<Self, MediaError> {
        Self::resolve_controlled(None)
    }

    pub(super) fn resolve_controlled(
        control: Option<crate::preparation::Control>,
    ) -> Result<Self, MediaError> {
        let cancel = control
            .as_ref()
            .map(|c| c.cancel.clone())
            .unwrap_or_default();
        if let Some(control) = &control {
            control.stage(crate::preparation::Stage::Runtime)?;
        }
        cancel.check()?;
        let lease = crate::resource_leases::configured(&["ffmpeg-cpu"])?;
        let ffmpeg_path = resolve_runtime_tool("SIAOVPLAY_FFMPEG", "ffmpeg.exe")?;
        let ffprobe_path = resolve_runtime_tool("SIAOVPLAY_FFPROBE", "ffprobe.exe")?;
        let version = tool_version(&ffmpeg_path, &cancel)?;
        Ok(Self {
            cancel,
            control,
            _lease: lease,
            ffmpeg_path,
            ffprobe_path,
            version,
        })
    }

    pub(super) fn status() -> MediaRuntimeStatus {
        match Self::resolve() {
            Ok(runtime) => MediaRuntimeStatus {
                available: true,
                ffmpeg_path: Some(path_to_string(&runtime.ffmpeg_path)),
                ffprobe_path: Some(path_to_string(&runtime.ffprobe_path)),
                version: Some(runtime.version),
                error_message: None,
            },
            Err(error) => MediaRuntimeStatus {
                available: false,
                ffmpeg_path: None,
                ffprobe_path: None,
                version: None,
                error_message: Some(error.to_string()),
            },
        }
    }

    pub(super) fn stage(&self, stage: crate::preparation::Stage) -> Result<(), MediaError> {
        if let Some(control) = &self.control {
            control.stage(stage)?;
        }
        self.cancel.check()?;
        Ok(())
    }

    pub(super) fn probe(&self, media_path: &Path) -> Result<MediaProbe, MediaError> {
        let mut command = hidden_command(&self.ffprobe_path);
        command
            .args([
                "-v",
                "error",
                "-show_format",
                "-show_streams",
                "-of",
                "json",
            ])
            .arg(media_path);
        let output =
            crate::cancellable_process::output(&mut command, &self.cancel).map_err(|error| {
                MediaError::ProbeFailed(format!(
                    "无法启动 {}：{error}",
                    self.ffprobe_path.display()
                ))
            })?;
        if !output.status.success() {
            return Err(MediaError::ProbeFailed(command_error_message(&output)));
        }
        parse_probe_output(&output.stdout)
    }
}
