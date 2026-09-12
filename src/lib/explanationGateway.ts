import { invoke } from "@tauri-apps/api/core";
import { parseExplanation, parseExplanationApplication, parseExplanationTask, parseExplanationTasks, parseExplanations } from "./explanationContract";
import type { Explanation, ExplanationTask, ExplanationApplication, PromptSelection } from "../types";

export async function prepareExplanationTask(
  projectId: string,
  handoffKind: "manual" | "codex",
  playbackCutoffMs: number,
  includeFrames: boolean,
  promptSelection: PromptSelection,
): Promise<ExplanationTask> {
  return parseExplanationTask(await invoke<unknown>("prepare_explanation_task", {
    input: { projectId, handoffKind, playbackCutoffMs, includeFrames, promptSelection },
  }), { projectId, handoffKind });
}
export async function getExplanationTask(
  taskId: string,
): Promise<ExplanationTask> {
  return parseExplanationTask(await invoke<unknown>("get_explanation_task", { taskId }), { taskId });
}

export async function listExplanationTasks(
  projectId: string,
): Promise<ExplanationTask[]> {
  return parseExplanationTasks(await invoke<unknown>("list_explanation_tasks", { projectId }), projectId);
}

export async function readExplanationPrompt(taskId: string): Promise<string> {
  const value = await invoke<unknown>("read_explanation_prompt", { taskId });
  if (typeof value !== "string") throw new Error("提示词读取结果无效，请重新读取。");
  return value;
}

export async function openExplanationMaterials(
  taskId: string,
): Promise<boolean> {
  const value = await invoke<unknown>("open_explanation_materials", { taskId });
  if (typeof value !== "boolean") throw new Error("打开材料目录的结果尚未确认，请检查目录窗口。");
  return value;
}

export async function getExplanation(
  explanationId: string,
): Promise<Explanation> {
  return parseExplanation(await invoke<unknown>("get_explanation", { explanationId }), { explanationId });
}

export async function listExplanations(
  projectId: string,
): Promise<Explanation[]> {
  return parseExplanations(await invoke<unknown>("list_explanations", { projectId }), projectId);
}

export async function importExplanationResult(
  taskId: string,
  resultPath: string,
): Promise<ExplanationApplication> {
  return parseExplanationApplication(await invoke<unknown>("import_explanation_result", {
    input: { taskId, resultPath },
  }), taskId);
}

export async function startCodexExplanationTask(
  taskId: string,
  timeoutSeconds: number | undefined,
  confirmationSha256: string,
): Promise<ExplanationTask> {
  return parseExplanationTask(await invoke<unknown>("start_codex_explanation_task", {
    input: { taskId, timeoutSeconds }, confirmationSha256,
  }), { taskId });
}

export async function cancelExplanationTask(
  taskId: string,
): Promise<ExplanationTask> {
  return parseExplanationTask(await invoke<unknown>("cancel_explanation_task", { taskId }), { taskId });
}

export async function resumeCodexExplanationTask(
  taskId: string,
  timeoutSeconds: number | undefined,
  confirmationSha256: string,
): Promise<ExplanationTask> {
  return parseExplanationTask(await invoke<unknown>("resume_codex_explanation_task", {
    input: { taskId, timeoutSeconds }, confirmationSha256,
  }), { taskId });
}
