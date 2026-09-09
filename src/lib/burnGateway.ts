import { invoke } from "@tauri-apps/api/core";
import { parseSubtitleBurnJob, parseSubtitleBurnJobs } from "./burnContract";
import type { SubtitleBurnJob, SubtitleBurnMode, SubtitleBurnStyle } from "../types";

export async function startSubtitleBurn(
  projectId: string,
  mode: SubtitleBurnMode,
  sourceVersionId: string | null,
  translationVersionId: string,
  destinationDirectory: string,
  style: SubtitleBurnStyle,
): Promise<SubtitleBurnJob> {
  return parseSubtitleBurnJob(await invoke<unknown>("start_subtitle_burn", {
    input: {
      projectId,
      mode,
      sourceVersionId,
      translationVersionId,
      destinationDirectory,
      style,
      confirmVersionSelection: true,
    },
  }), { projectId, mode, sourceVersionId: mode === "bilingual" ? sourceVersionId : null, translationVersionId });
}

export async function getSubtitleBurnJob(
  jobId: string,
): Promise<SubtitleBurnJob> {
  return parseSubtitleBurnJob(await invoke<unknown>("get_subtitle_burn_job", {
    input: { jobId },
  }), { jobId });
}

export async function listSubtitleBurnJobs(
  projectId: string,
): Promise<SubtitleBurnJob[]> {
  return parseSubtitleBurnJobs(await invoke<unknown>("list_subtitle_burn_jobs", { projectId }), projectId);
}

export async function cancelSubtitleBurnJob(
  jobId: string,
): Promise<SubtitleBurnJob> {
  return parseSubtitleBurnJob(await invoke<unknown>("cancel_subtitle_burn_job", {
    input: { jobId },
  }), { jobId });
}

export async function resumeSubtitleBurnJob(
  jobId: string,
): Promise<SubtitleBurnJob> {
  return parseSubtitleBurnJob(await invoke<unknown>("resume_subtitle_burn_job", {
    input: { jobId },
  }), { jobId });
}
