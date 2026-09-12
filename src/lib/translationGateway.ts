import { parseTranslationApplication, parseTranslationTask, parseTranslationTasks } from "./translationContract";
import { invoke } from "@tauri-apps/api/core";
import type { TranslationApplication, TranslationTask } from "../types";

export async function prepareTranslationTask(
  projectId: string,
  handoffKind: "manual" | "codex",
  sourceLanguageCode: string,
  targetLanguageCode: string,
  segmentIds?: string[],
): Promise<TranslationTask> {
  return parseTranslationTask(await invoke<unknown>("prepare_translation_task", {
    input: {
      projectId,
      handoffKind,
      sourceLanguageCode,
      targetLanguageCode,
      segmentIds,
    },
  }), { projectId, handoffKind });
}

export async function getTranslationTask(
  taskId: string,
): Promise<TranslationTask> {
  return parseTranslationTask(await invoke<unknown>("get_translation_task", {
    input: { taskId },
  }), { taskId });
}

export async function listTranslationTasks(
  projectId: string,
): Promise<TranslationTask[]> {
  return parseTranslationTasks(await invoke<unknown>("list_translation_tasks", { projectId }), projectId);
}

export async function readTranslationPrompt(taskId: string): Promise<string> {
  const value = await invoke<unknown>("read_translation_prompt", {
    input: { taskId },
  });
  if (typeof value !== "string") throw new Error("提示词读取结果无效，请重新读取。");
  return value;
}

export async function importTranslationResult(
  taskId: string,
  resultPath: string,
): Promise<TranslationApplication> {
  return parseTranslationApplication(await invoke<unknown>("import_translation_result", {
    input: { taskId, resultPath },
  }), taskId);
}

export async function startCodexTranslationTask(
  taskId: string,
  timeoutSeconds: number | undefined,
  confirmationSha256: string,
): Promise<TranslationTask> {
  return parseTranslationTask(await invoke<unknown>("start_codex_translation_task", {
    input: { taskId, timeoutSeconds },
    confirmationSha256,
  }), { taskId });
}

export async function cancelTranslationTask(
  taskId: string,
): Promise<TranslationTask> {
  return parseTranslationTask(await invoke<unknown>("cancel_translation_task", {
    input: { taskId },
  }), { taskId });
}

export async function resumeCodexTranslationTask(
  taskId: string,
  timeoutSeconds: number | undefined,
  confirmationSha256: string,
): Promise<TranslationTask> {
  return parseTranslationTask(await invoke<unknown>("resume_codex_translation_task", {
    input: { taskId, timeoutSeconds },
    confirmationSha256,
  }), { taskId });
}
