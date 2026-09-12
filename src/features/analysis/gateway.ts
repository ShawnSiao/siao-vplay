import { invoke } from "@tauri-apps/api/core";

import type {
  AnalysisPromptTemplate,
  AnalysisTaskType,
  SaveAnalysisPromptTemplateInput,
} from "./types";

export async function listAnalysisPromptTemplates(
  taskType: AnalysisTaskType | null = null,
): Promise<AnalysisPromptTemplate[]> {
  const value = await invoke<unknown>("list_analysis_prompt_templates", {
    input: { taskType },
  });
  if (!Array.isArray(value)) throw invalidTemplate(false);
  const { default: validate } = await import("../../generated/analysis-prompt-template.validator.mjs");
  const ids = new Set<string>();
  for (const row of value) {
    if (!validate(row) || !validIdentity(row) || ids.has(row.id) ||
        (taskType !== null && row.taskType !== taskType)) throw invalidTemplate(false);
    ids.add(row.id);
  }
  return value as AnalysisPromptTemplate[];
}

export async function saveAnalysisPromptTemplate(
  input: SaveAnalysisPromptTemplateInput,
): Promise<AnalysisPromptTemplate> {
  const value = await invoke<unknown>("save_analysis_prompt_templates", { input });
  const { default: validate } = await import("../../generated/analysis-prompt-template.validator.mjs");
  const expectedId = input.id?.trim();
  if (!validate(value) || !validIdentity(value) || value.isBuiltin ||
      (expectedId && value.id !== expectedId) || value.taskType !== input.taskType ||
      value.baseTemplateId !== input.baseTemplateId || value.name !== input.name.trim() ||
      value.customRequirements !== input.customRequirements.trim()) throw invalidTemplate(true);
  return value;
}

export function deleteAnalysisPromptTemplate(id: string): Promise<void> {
  return invoke("delete_analysis_prompt_templates", { input: { id } });
}

function validIdentity(value: AnalysisPromptTemplate): boolean {
  return !!value.id.trim() && !!value.baseTemplateId.trim() && !!value.name.trim();
}

function invalidTemplate(saving: boolean): Error {
  return new Error(saving
    ? "模板保存结果尚未确认，请刷新模板列表后检查。"
    : "模板列表格式或任务类型不匹配，未采用本次结果。");
}
