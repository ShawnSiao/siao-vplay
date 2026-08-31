use crate::{
    media::MediaError, remote_media::RemoteMediaError, store::StoreError,
    youtube_media::YouTubeMediaError,
};

pub(crate) fn classify(error: &YouTubeMediaError) -> (&'static str, &'static str) {
    let code = match error {
        YouTubeMediaError::Network(RemoteMediaError::PrivateNetwork) => "remote_private_network",
        YouTubeMediaError::Network(_) => "youtube_preflight_failed",
        YouTubeMediaError::UnsupportedUrl => "youtube_url_unsupported",
        YouTubeMediaError::PlaylistNotAllowed => "youtube_playlist_not_allowed",
        YouTubeMediaError::Restricted => "youtube_restricted",
        YouTubeMediaError::ToolUnavailable(_) => "youtube_runtime_unavailable",
        YouTubeMediaError::ToolIntegrity | YouTubeMediaError::ToolVersion => {
            "youtube_runtime_invalid"
        }
        YouTubeMediaError::InspectionTimeout => "youtube_inspection_timeout",
        YouTubeMediaError::InspectionFailed(_) => "youtube_inspection_failed",
        YouTubeMediaError::MetadataInvalid(_) => "youtube_metadata_invalid",
        YouTubeMediaError::SelectedMediaUnsafe => "youtube_selected_media_unsafe",
        YouTubeMediaError::PreviewChanged => "youtube_preview_changed",
        YouTubeMediaError::SizeLimit => "remote_size_limit",
        YouTubeMediaError::DownloadTimeout => "youtube_download_timeout",
        YouTubeMediaError::DownloadFailed(_) => "youtube_download_failed",
        YouTubeMediaError::Cancelled => "remote_import_cancelled",
        YouTubeMediaError::FileSystem(_) => "filesystem_error",
        YouTubeMediaError::Media(MediaError::RuntimeUnavailable(_)) => "media_runtime_unavailable",
        YouTubeMediaError::Media(MediaError::MissingVideo) => "missing_video_stream",
        YouTubeMediaError::Media(_) => "media_inspection_failed",
        YouTubeMediaError::Store(StoreError::ProjectNotFound(_)) => "project_not_found",
        YouTubeMediaError::Store(StoreError::Validation(_)) => "validation_error",
        YouTubeMediaError::Store(StoreError::UnsupportedSchema { .. }) => "unsupported_schema",
        YouTubeMediaError::Store(StoreError::FileSystem(_)) => "filesystem_error",
        YouTubeMediaError::Store(_) => "database_error",
    };
    (code, message(code))
}

fn message(code: &str) -> &'static str {
    match code {
        "remote_private_network" => "不能导入本机或局域网地址。请选择公开视频页面。",
        "youtube_preflight_failed" => "无法连接到公开视频页面。请检查网络后重试。",
        "youtube_url_unsupported" => "当前只支持公开 HTTPS 单视频页面。",
        "youtube_playlist_not_allowed" => "暂不支持播放列表。请使用单个公开视频页面。",
        "youtube_restricted" => "这个视频需要登录、付费或其他访问条件，无法导入。",
        "youtube_runtime_unavailable" => "公开视频功能尚未准备。请在环境配置中完成准备。",
        "youtube_runtime_invalid" => "公开视频组件需要更新。请在环境配置中更新后重试。",
        "youtube_inspection_timeout" => "公开视频检查超时。请检查网络后重试。",
        "youtube_inspection_failed" => "无法读取这个公开页面。请更新公开视频组件或稍后重试。",
        "youtube_metadata_invalid" => "公开视频页面返回的信息不完整。请稍后重新检查。",
        "youtube_selected_media_unsafe" => "视频返回的媒体地址未通过公开网络检查。",
        "youtube_preview_changed" => "视频在检查后发生变化。请重新检查后再导入。",
        "remote_size_limit" => "视频超过当前允许的导入大小。",
        "youtube_download_timeout" => "公开视频导入超时。可以稍后重试。",
        "youtube_download_failed" => "公开视频暂时无法下载。请更新组件并重新检查。",
        "remote_import_cancelled" => "在线视频导入已取消。",
        "filesystem_error" => "无法保存公开视频的本地副本。请检查磁盘后重试。",
        "media_runtime_unavailable" => "基础视频功能尚未准备。请在环境配置中完成准备。",
        "missing_video_stream" => "文件中没有找到可播放的视频画面。",
        "media_inspection_failed" => "下载完成，但无法读取这个视频的媒体信息。",
        "project_not_found" => "没有找到对应项目。请返回媒体库后重试。",
        "validation_error" => "公开视频导入参数没有通过检查。请重新检查地址。",
        "unsupported_schema" => "本机数据来自不兼容的版本。请更新 SiaoVPlay。",
        "database_error" => "本机媒体库暂时无法写入。重新启动 SiaoVPlay 后重试。",
        _ => "公开视频导入没有完成。现有媒体库内容没有改变。",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloader_output_and_paths_never_enter_the_command_message() {
        let error = YouTubeMediaError::DownloadFailed(
            "ERROR: HTTP 403 https://signed.example/video at C:\\private\\movie.mp4".to_owned(),
        );
        let (code, user_message) = classify(&error);

        assert_eq!(code, "youtube_download_failed");
        assert!(user_message.contains("更新组件"));
        assert!(!user_message.contains("403"));
        assert!(!user_message.contains("signed.example"));
        assert!(!user_message.contains("C:\\"));
    }

    #[test]
    fn invalid_runtime_points_to_environment_configuration() {
        let (code, user_message) = classify(&YouTubeMediaError::ToolVersion);

        assert_eq!(code, "youtube_runtime_invalid");
        assert!(user_message.contains("环境配置"));
    }
}
