import type {
  LocalResourceCapabilityStatus,
  ResourceDownloadTask,
  ResourceNetworkStatus,
} from "../../types";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "待确认";
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes >= 100_000_000 ? 0 : 1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function resourceDownloadBytes(
  resource: { artifact?: { size: number }; expectedDownloadSize?: number } | undefined,
): number {
  return resource?.artifact?.size ?? resource?.expectedDownloadSize ?? 0;
}

export function formatRemaining(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "正在估算剩余时间";
  if (seconds < 60) return "预计不到 1 分钟";
  if (seconds < 3_600) return `预计 ${Math.ceil(seconds / 60)} 分钟`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  return `预计 ${hours} 小时 ${minutes} 分钟`;
}

export function capabilityStateLabel(
  capability: LocalResourceCapabilityStatus,
  installable: boolean,
): string {
  if (capability.state === "ready") return "已准备";
  if (capability.state === "preparing") return "准备中";
  if (capability.state === "repair_required") return "需要修复";
  if (capability.state === "root_unavailable") return "保存位置不可用";
  if (capability.state === "update_available") return "可更新";
  return installable ? "按需准备" : "暂不可用";
}

export function taskStateLabel(task: ResourceDownloadTask): string {
  const labels: Record<ResourceDownloadTask["state"], string> = {
    queued: "等待下载", downloading: "正在下载", paused: "已暂停",
    verifying: "正在检查", installing: "正在启用", completed: "已完成",
    failed: "准备失败", cancelled: "已取消",
  };
  return labels[task.state];
}

export function networkSourceLabel(
  source: ResourceNetworkStatus["proxySource"] | undefined,
): string {
  if (source === "custom") return "使用指定代理";
  if (source === "environment") return "使用应用启动环境中的代理";
  if (source === "windows_system") return "跟随 Windows 系统代理";
  return "当前直连";
}

export const capabilityDescriptions: Record<string, string> = {
  basic_media: "播放更多常见视频格式，并在需要时生成兼容播放版本。",
  url_import: "从公开 HTTPS 地址或公开视频页面保存本地副本。",
  local_transcription: "从英语、泰语、日语和韩语原声生成原文字幕。",
  high_performance_transcription: "兼容的电脑可以缩短本地字幕识别等待时间。",
};
