import validate from "../generated/subtitle-burn-job.validator.mjs";
import type { SubtitleBurnJob } from "../types";
type Expected = { jobId?: string; projectId?: string; mode?: SubtitleBurnJob["mode"]; sourceVersionId?: string | null; translationVersionId?: string };
export function parseSubtitleBurnJob(value: unknown, expected: Expected = {}): SubtitleBurnJob {
  if (!validate(value) || !value.id.trim() || !value.projectId.trim() || !value.translationVersionId.trim() ||
    (value.sourceVersionId !== null && !value.sourceVersionId.trim()) || (value.mode === "bilingual" && value.sourceVersionId === null) ||
    (value.outputSha256 !== null && !/^[a-f0-9]{64}$/i.test(value.outputSha256)) ||
    (value.status === "completed" && (!value.outputPath?.trim() || !value.manifestPath?.trim() || !value.outputSha256)) ||
    (expected.jobId !== undefined && value.id !== expected.jobId) || (expected.projectId !== undefined && value.projectId !== expected.projectId) ||
    (expected.mode !== undefined && value.mode !== expected.mode) ||
    (expected.sourceVersionId !== undefined && value.sourceVersionId !== expected.sourceVersionId) ||
    (expected.translationVersionId !== undefined && value.translationVersionId !== expected.translationVersionId)) {
    throw new Error("字幕烧录任务格式无效或与当前请求、字幕选择不匹配。");
  }
  return value;
}
export function parseSubtitleBurnJobs(value: unknown, projectId: string): SubtitleBurnJob[] {
  if (!Array.isArray(value)) throw new Error("字幕烧录任务列表格式无效。");
  const jobs = value.map(job => parseSubtitleBurnJob(job, { projectId }));
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error("字幕烧录任务列表包含重复任务。");
  return jobs;
}
