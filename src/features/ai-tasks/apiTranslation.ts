import { invoke } from "@tauri-apps/api/core";
import type { TranslationTask } from "../../types";
import type { AiExecutionTarget } from "../environment-settings/types";

export async function prepareApiTranslation(projectId: string, sourceLanguageCode: string, targetLanguageCode: string,
  segmentIds: string[] | undefined, execution: AiExecutionTarget | null, serviceRevision: number | null) {
  if (execution?.kind !== "api" || serviceRevision === null) throw new Error("请先配置 AI 服务并选择模型。");
  return invoke<TranslationTask>("prepare_api_translation", { input: { projectId, sourceLanguageCode, targetLanguageCode,
    segmentIds: segmentIds ?? null, execution, serviceRevision } });
}

export function startApiTranslation(taskId: string, confirmationSha256: string) {
  return invoke<TranslationTask>("start_api_translation", { input: { taskId, confirmationSha256 } });
}
