use super::*;

#[derive(Clone, Debug)]
pub(super) struct MediaRuntime {
    pub(super) ffmpeg_path: PathBuf,
    pub(super) ffprobe_path: PathBuf,
    pub(super) version: String,
    _lease: crate::resource_usage::ResourceLease,
}

impl MediaRuntime {
    pub(super) fn resolve() -> Result<Self, MediaError> {
        let lease = crate::resource_leases::configured(&["ffmpeg-cpu"])?;
        let ffmpeg_path = resolve_runtime_tool("SIAOVPLAY_FFMPEG", "ffmpeg.exe")?;
        let ffprobe_path = resolve_runtime_tool("SIAOVPLAY_FFPROBE", "ffprobe.exe")?;
        let version = tool_version(&ffmpeg_path)?;
        Ok(Self {
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

    pub(super) fn probe(&self, media_path: &Path) -> Result<MediaProbe, MediaError> {
        let output = hidden_command(&self.ffprobe_path)
            .args([
                "-v",
                "error",
                "-show_format",
                "-show_streams",
                "-of",
                "json",
            ])
            .arg(media_path)
            .output()
            .map_err(|error| {
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
