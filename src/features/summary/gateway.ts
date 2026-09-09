import { parseSummaryExport } from "./exportContract";
import { parseVideoSummary, parseVideoSummaries } from "./resultContract";
import { parseSummaryTask, parseSummaryTasks } from "./taskContract";
import { invoke } from "@tauri-apps/api/core";
export { previewSummaryDispatch } from "./dispatchGateway";

import { chooseConfiguredStorageDirectory } from "../../lib/storageDirectoryPicker";

import type {
  PrepareSummaryTaskInput,
  SummaryExport,
  SummaryTask,
  VideoSummary,
} from "./types";

export async function prepareSummaryTask(input: PrepareSummaryTaskInput): Promise<SummaryTask> {
  return parseSummaryTask(await invoke<unknown>("prepare_summary_task", { input }), { projectId: input.projectId });
}

export async function startSummaryTask(taskId: string, confirmationSha256: string): Promise<SummaryTask> {
  return parseSummaryTask(await invoke<unknown>("start_summary_task", { input: { taskId, confirmationSha256 } }), { taskId });
}

export async function resumeSummaryTask(taskId: string, confirmationSha256: string): Promise<SummaryTask> {
  return parseSummaryTask(await invoke<unknown>("resume_summary_task", { input: { taskId, confirmationSha256 } }), { taskId });
}

export async function cancelSummaryTask(taskId: string): Promise<SummaryTask> {
  return parseSummaryTask(await invoke<unknown>("cancel_summary_task", { input: { taskId } }), { taskId });
}

export async function getSummaryTask(taskId: string): Promise<SummaryTask> {
  return parseSummaryTask(await invoke<unknown>("get_summary_task", { input: { taskId } }), { taskId });
}

export async function listSummaryTasks(projectId: string): Promise<SummaryTask[]> {
  return parseSummaryTasks(await invoke<unknown>("list_summary_tasks", { input: { projectId } }), projectId);
}

export async function getVideoSummary(summaryId: string): Promise<VideoSummary> {
  return parseVideoSummary(await invoke<unknown>("get_video_summary", { input: { summaryId } }), { summaryId });
}

export async function listVideoSummaries(projectId: string): Promise<VideoSummary[]> {
  return parseVideoSummaries(await invoke<unknown>("list_video_summaries", { input: { projectId } }), projectId);
}

export async function chooseSummaryExportDirectory(): Promise<string | null> {
  return chooseConfiguredStorageDirectory("report", "选择视频分析报告保存位置");
}

export async function exportVideoSummary(
  summaryId: string,
  directory: string,
): Promise<SummaryExport> {
  const value = await invoke<unknown>("export_video_summary", { input: { summaryId, directory } });
  return parseSummaryExport(value, summaryId, directory);
}

export function openSummaryMaterials(taskId: string): Promise<boolean> {
  return invoke("open_summary_materials", { input: { taskId } });
}
