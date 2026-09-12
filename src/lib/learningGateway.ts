import { invoke } from "@tauri-apps/api/core";
import { parseLearningTask, parseLearningTasks, parseLearningApplication } from "./learningContract";
import type { LearningTask, LearningApplication, LearningSelectionKind } from "../types";

export async function prepareLearningTask(
  projectId: string,
  handoffKind: "manual" | "codex",
  sourceSegmentId: string,
  selectedText: string,
  selectionKind: LearningSelectionKind,
  playbackPositionMs: number,
): Promise<LearningTask> {
  return parseLearningTask(await invoke<unknown>("prepare_learning_task", {
    input: {
      projectId,
      handoffKind,
      sourceSegmentId,
      selectedText,
      selectionKind,
      playbackPositionMs,
    },
  }), { projectId, handoffKind });
}

export async function getLearningTask(taskId: string): Promise<LearningTask> {
  return parseLearningTask(await invoke<unknown>("get_learning_task", { taskId }), { taskId });
}

export async function listLearningTasks(
  projectId: string,
): Promise<LearningTask[]> {
  return parseLearningTasks(await invoke<unknown>("list_learning_tasks", { projectId }), projectId);
}

export async function readLearningPrompt(taskId: string): Promise<string> {
  const value = await invoke<unknown>("read_learning_prompt", { taskId });
  if (typeof value !== "string") throw new Error("提示词读取结果无效，请重新读取。");
  return value;
}

export async function importLearningResult(
  taskId: string,
  resultPath: string,
): Promise<LearningApplication> {
  return parseLearningApplication(await invoke<unknown>("import_learning_result", {
    input: { taskId, resultPath },
  }), taskId);
}

export async function startCodexLearningTask(
  taskId: string,
  timeoutSeconds: number | undefined,
  confirmationSha256: string,
): Promise<LearningTask> {
  return parseLearningTask(await invoke<unknown>("start_codex_learning_task", {
    input: { taskId, timeoutSeconds }, confirmationSha256,
  }), { taskId });
}

export async function cancelLearningTask(
  taskId: string,
): Promise<LearningTask> {
  return parseLearningTask(await invoke<unknown>("cancel_learning_task", { taskId }), { taskId });
}

export async function resumeCodexLearningTask(
  taskId: string,
  timeoutSeconds: number | undefined,
  confirmationSha256: string,
): Promise<LearningTask> {
  return parseLearningTask(await invoke<unknown>("resume_codex_learning_task", {
    input: { taskId, timeoutSeconds }, confirmationSha256,
  }), { taskId });
}
