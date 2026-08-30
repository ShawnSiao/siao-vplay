import type { DesktopCommandError } from "../types";
import { commandError } from "./desktop";

export type ErrorContext =
  | "library"
  | "playback"
  | "subtitle"
  | "settings"
  | "background";

const errorMessages: Record<string, string> = {
  project_not_found: "没有找到对应项目。返回媒体库后重新选择视频。",
  collection_not_found: "没有找到对应合集。刷新媒体库后重试。",
  membership_not_found: "这个视频已不在当前合集中。刷新媒体库后继续。",
  library_conflict: "媒体库内容已发生变化。刷新后再执行这项操作。",
  library_scan_cancelled: "文件夹扫描已取消。现有媒体库内容没有改变。",
  library_scan_not_found: "本次文件夹扫描已失效。请重新选择文件夹。",
  library_preview_not_found: "导入检查结果已失效。请重新扫描文件夹。",
  library_preview_expired: "导入检查结果已过期。请重新扫描文件夹。",
  unsupported_schema: "本机数据来自不兼容的版本。更新 SiaoVPlay 后重试。",
  validation_error: "输入内容没有通过检查。请核对后重试。",
  filesystem_error: "无法访问所需文件。请检查文件是否仍存在，以及所在磁盘是否可用。",
  runtime_filesystem_error: "无法访问本地功能文件。请在「环境配置」中检查保存位置。",
  database_error: "本机项目数据暂时无法读取。重新启动 SiaoVPlay 后重试。",
  media_runtime_unavailable: "基础视频功能尚未准备。请在「环境配置」中完成准备后重试。",
  media_probe_failed: "无法读取这个视频的媒体信息。原文件没有改变，可以重新检查或选择其他文件。",
  media_inspection_failed: "无法检查这个视频。原文件没有改变，可以重新尝试。",
  media_source_changed: "视频文件在处理期间发生变化。请重新打开项目后重试。",
  media_changed: "视频文件在处理期间发生变化。请重新打开项目后重试。",
  project_changed: "项目内容在处理期间发生变化。请重新打开后重试。",
  missing_video_stream: "文件中没有找到可播放的视频画面。",
  playback_proxy_failed: "兼容播放版本生成失败。原文件、字幕和观看记录没有改变。",
  media_poster_failed: "视频缩略图暂时无法生成，不影响继续观看。",
  embedded_subtitle_not_found: "没有找到所选内嵌字幕轨。请重新选择字幕。",
  embedded_subtitle_unsupported: "当前字幕编码暂不支持。可以导入 SRT 或 VTT 字幕。",
  embedded_subtitle_extraction_failed: "内嵌字幕读取失败。可以重新尝试或导入字幕文件。",
  subtitle_format_unsupported: "当前字幕格式暂不支持。请选择 SRT 或 VTT 文件。",
  subtitle_encoding_unsupported: "无法识别字幕文件编码。请转换为 UTF-8 后重试。",
  subtitle_parse_failed: "字幕文件内容无法读取。请检查时间码和文本格式。",
  subtitle_preflight_blocked: "字幕没有通过时间轴检查。请修正问题后重试。",
  subtitle_source_changed: "原文字幕已发生变化。请重新开始这项操作。",
  subtitle_version_changed: "字幕版本已发生变化。请重新打开字幕后重试。",
  translation_task_active: "当前已有中文字幕任务正在进行。",
  remote_url_invalid: "链接格式无效。请输入完整的 HTTPS 地址。",
  remote_https_required: "只支持 HTTPS 公开链接。",
  remote_credentials_not_allowed: "链接不能包含账号、密码或其他认证信息。",
  remote_private_network: "不能导入本机或局域网地址。请选择公开媒体链接。",
  remote_dns_failed: "无法解析链接地址。请检查网络和域名后重试。",
  remote_redirect_invalid: "链接跳转异常。请使用媒体的最终公开地址。",
  remote_request_failed: "无法连接到媒体地址。请检查网络后重试。",
  remote_content_unsupported: "这个链接没有返回受支持的视频内容。",
  remote_size_limit: "媒体文件超过当前允许的导入大小。",
  remote_preview_changed: "远程媒体在检查后发生变化。请重新检查链接。",
  remote_import_cancelled: "在线视频导入已取消。",
  remote_hls_failed: "无法读取这个 HLS 视频。请检查播放列表是否仍然公开。",
  youtube_url_unsupported: "当前只支持 YouTube 或 X 的公开单视频页面。",
  youtube_playlist_not_allowed: "暂不支持播放列表。请使用单个公开视频页面。",
  youtube_live_not_allowed: "暂不支持直播内容。请选择已发布的公开视频。",
  youtube_restricted: "这个视频需要登录、付费或其他访问条件，无法导入。",
  youtube_preflight_failed: "无法连接到公开视频页面。请检查网络或代理设置后重试。",
  youtube_media_uncertain: "无法确认这是可公开读取的单个视频。请检查页面是否仍然公开。",
  youtube_runtime_unavailable: "公开视频功能尚未准备。请在「环境配置」中完成准备后重试。",
  youtube_runtime_invalid: "公开视频组件需要更新。请在「环境配置」中更新后重新检查。",
  youtube_inspection_timeout: "公开视频检查超时。请检查网络后重试。",
  youtube_inspection_failed: "无法读取这个公开页面。请确认页面仍然公开，并更新公开视频组件后重试。",
  youtube_metadata_invalid: "公开视频页面返回的信息不完整。请更新公开视频组件或稍后重试。",
  youtube_selected_media_unsafe: "视频返回的媒体地址未通过公开网络检查，已停止导入。",
  youtube_preview_changed: "视频在检查后发生变化。请重新检查后再导入。",
  youtube_download_timeout: "公开视频导入超时。现有媒体库内容没有改变，可以稍后重试。",
  youtube_download_failed: "公开视频暂时无法下载。请更新公开视频组件并重新检查；如果已经是最新版本，可以稍后或更换网络重试。",
  missing_audio_stream: "文件中没有找到可用于字幕识别的音轨。",
  transcription_runtime_unavailable: "本地字幕识别功能尚未准备。请在「环境配置」中完成准备。",
  transcription_model_unavailable: "所选字幕识别模型尚未准备。请在「环境配置」中完成准备。",
  transcription_already_running: "当前项目已有字幕识别任务正在进行。",
  transcription_cancelled: "字幕识别已取消。现有字幕版本没有改变。",
  timeout: "处理超时。可以检查网络后重试。",
  codex_timeout: "处理超时。当前项目内容没有改变，可以重新尝试。",
};

const contextFallbacks: Record<ErrorContext, string> = {
  library: "媒体库操作没有完成。现有视频、字幕和观看记录没有改变，可以重试。",
  playback: "播放器没有完成这项操作。原文件、字幕和观看记录没有改变。",
  subtitle: "字幕处理没有完成。现有字幕版本和原视频没有改变。",
  settings: "环境配置没有完成保存。现有配置和本地资源没有改变。",
  background: "后台处理没有完成。当前项目内容没有改变，可以重新尝试。",
};

export function userFacingCommandError(
  error: unknown,
  context: ErrorContext,
): string {
  const failure: DesktopCommandError = commandError(error);
  return errorMessages[failure.code] ?? contextFallbacks[context];
}
