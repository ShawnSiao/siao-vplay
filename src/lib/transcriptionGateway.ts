import { invoke } from "@tauri-apps/api/core";
import type { TranscriptionJob } from "../types";
import validate from "../generated/transcription-job.validator.mjs";

function parseJob(value: unknown, expected: { jobId?: string; projectId?: string } = {}): TranscriptionJob {
  if (!validate(value) || !value.id.trim() || !value.projectId.trim() ||
    (expected.jobId !== undefined && value.id !== expected.jobId) ||
    (expected.projectId !== undefined && value.projectId !== expected.projectId)) {
    throw new Error("转写任务返回的数据无效或与请求不匹配。");
  }
  return value;
}

export async function startTranscription(
  projectId: string,
  languageCode: TranscriptionJob["languageCode"],
  modelKind: TranscriptionJob["modelKind"] = "small",
  confirmReplaceOriginal = false,
): Promise<TranscriptionJob> {
  const job = parseJob(await invoke<unknown>("start_transcription", {
    input: { projectId, languageCode, modelKind, confirmReplaceOriginal },
  }), { projectId });
  if (job.languageCode !== languageCode || job.modelKind !== modelKind) {
    throw new Error("转写任务使用的语言或模型与请求不匹配。");
  }
  return job;
}

export async function getTranscriptionJob(jobId: string): Promise<TranscriptionJob> {
  return parseJob(await invoke<unknown>("get_transcription_job", { input: { jobId } }), { jobId });
}

export async function listTranscriptionJobs(projectId: string): Promise<TranscriptionJob[]> {
  const value = await invoke<unknown>("list_transcription_jobs", { projectId });
  if (!Array.isArray(value)) throw new Error("转写任务列表返回的数据无效。");
  const jobs = value.map(job => parseJob(job, { projectId }));
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error("转写任务列表包含重复任务。");
  return jobs;
}

export async function cancelTranscriptionJob(jobId: string): Promise<TranscriptionJob> {
  return parseJob(await invoke<unknown>("cancel_transcription_job", { input: { jobId } }), { jobId });
}

export async function resumeTranscriptionJob(jobId: string): Promise<TranscriptionJob> {
  return parseJob(await invoke<unknown>("resume_transcription_job", { input: { jobId } }), { jobId });
}
