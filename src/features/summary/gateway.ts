import { invoke } from "@tauri-apps/api/core";
export { previewSummaryDispatch } from "./dispatchGateway";

import { chooseConfiguredStorageDirectory } from "../storage/directoryPicker";

import type {
  PrepareSummaryTaskInput,
  SummaryExport,
  SummaryTask,
  VideoSummary,
} from "./types";

export function prepareSummaryTask(input: PrepareSummaryTaskInput): Promise<SummaryTask> {
  return invoke("prepare_summary_task", { input });
}

export function startSummaryTask(taskId: string, confirmationSha256: string): Promise<SummaryTask> {
  return invoke("start_summary_task", { input: { taskId, confirmationSha256 } });
}

export function resumeSummaryTask(taskId: string, confirmationSha256: string): Promise<SummaryTask> {
  return invoke("resume_summary_task", { input: { taskId, confirmationSha256 } });
}

export function cancelSummaryTask(taskId: string): Promise<SummaryTask> {
  return invoke("cancel_summary_task", { input: { taskId } });
}

export function getSummaryTask(taskId: string): Promise<SummaryTask> {
  return invoke("get_summary_task", { input: { taskId } });
}

export function listSummaryTasks(projectId: string): Promise<SummaryTask[]> {
  return invoke("list_summary_tasks", { input: { projectId } });
}

export function getVideoSummary(summaryId: string): Promise<VideoSummary> {
  return invoke("get_video_summary", { input: { summaryId } });
}

export function listVideoSummaries(projectId: string): Promise<VideoSummary[]> {
  return invoke("list_video_summaries", { input: { projectId } });
}

export async function chooseSummaryExportDirectory(): Promise<string | null> {
  return chooseConfiguredStorageDirectory("report", "选择视频分析报告保存位置");
}

export function exportVideoSummary(
  summaryId: string,
  directory: string,
): Promise<SummaryExport> {
  return invoke("export_video_summary", { input: { summaryId, directory } });
}

export function openSummaryMaterials(taskId: string): Promise<boolean> {
  return invoke("open_summary_materials", { input: { taskId } });
}
