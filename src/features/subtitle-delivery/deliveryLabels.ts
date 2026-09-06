import type { SubtitleVersionMetadata } from "../subtitle-revision/subtitleMetadata";
import { translationLanguageLabel } from "../../config/translationLanguages";
import type { SubtitleBurnJob } from "../../types";

export function versionLabel(version: SubtitleVersionMetadata) {
  const role =
    version.role === "original"
      ? "原文"
      : translationLanguageLabel(version.languageCode);
  const current = version.isCurrent ? " · 当前" : "";
  const status = version.status === "draft" ? " · 草稿" : "";
  return `${role} · 版本 ${version.versionNumber}${current}${status}`;
}

export function jobStatusLabel(job: SubtitleBurnJob) {
  if (job.status === "queued") return "等待开始";
  if (job.status === "running") return "正在烧录";
  if (job.status === "validating") return "正在检查视频";
  if (job.status === "completed") return "烧录已完成";
  if (job.status === "interrupted") return "上次任务已中断";
  if (job.status === "cancelled") return "任务已取消";
  return "烧录失败";
}
