import type { SubtitleVersion, TranscriptionJob } from "../../types";

type Decision = { kind: "waiting" } | { kind: "complete"; versionId: string } | { kind: "stop"; notice?: string };
const activeStatuses = new Set<TranscriptionJob["status"]>(["queued", "extracting", "transcribing", "validating"]);

export function transcriptionCompletion(job: TranscriptionJob, jobId: string, projectId: string): Decision {
  if (job.id !== jobId || job.projectId !== projectId) {
    return { kind: "stop", notice: "字幕任务与当前视频不匹配，未采用返回结果。请重新打开字幕工具检查。" };
  }
  if (activeStatuses.has(job.status)) return { kind: "waiting" };
  if (job.status === "failed") return { kind: "stop", notice: "原文字幕生成失败，可重新打开字幕工具后重试。" };
  if (job.status === "interrupted") return { kind: "stop", notice: "原文字幕生成已中断，可重新打开字幕工具后重试。" };
  if (job.status === "cancelled") return { kind: "stop", notice: "原文字幕生成已取消。" };
  if (job.status !== "completed" || !job.subtitleVersionId) {
    return { kind: "stop", notice: "字幕任务没有返回有效的字幕版本，请重新打开字幕工具检查。" };
  }
  return { kind: "complete", versionId: job.subtitleVersionId };
}

export function matchesTranscriptionOutput(version: Pick<SubtitleVersion, "id" | "projectId" | "role">, versionId: string, projectId: string) {
  return version.id === versionId && version.projectId === projectId && version.role === "original";
}
