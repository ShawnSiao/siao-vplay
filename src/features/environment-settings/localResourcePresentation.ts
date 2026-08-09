import type { LocalResourceCapabilityState, ResourceDownloadTaskState } from "../../types";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "待确认";
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes >= 100_000_000 ? 0 : 1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function capabilityStateLabel(state: LocalResourceCapabilityState): string {
  const labels: Record<LocalResourceCapabilityState, string> = {
    setup_required: "需要设置位置",
    not_ready: "按需准备",
    preparing: "准备中",
    ready: "可以使用",
    repair_required: "需要修复",
    root_unavailable: "保存位置不可用",
    update_available: "可更新",
  };
  return labels[state];
}

export function taskStateLabel(state: ResourceDownloadTaskState): string {
  const labels: Record<ResourceDownloadTaskState, string> = {
    queued: "等待下载",
    downloading: "正在下载",
    paused: "已暂停",
    verifying: "正在检查",
    installing: "正在启用",
    completed: "已完成",
    failed: "准备失败",
    cancelled: "已取消",
  };
  return labels[state];
}

export const capabilityDescriptions: Record<string, string> = {
  basic_media: "播放更多常见视频格式，并在需要时生成兼容播放版本。",
  url_import: "从公开 HTTPS 地址或公开视频页面保存本地副本。",
  local_transcription: "从英语、泰语、日语和韩语原声生成原文字幕。",
  high_performance_transcription: "兼容的电脑可以缩短本地字幕识别等待时间。",
};
