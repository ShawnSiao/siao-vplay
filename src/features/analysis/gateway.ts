import { invoke } from "@tauri-apps/api/core";

import type {
  AnalysisPromptTemplate,
  AnalysisTaskType,
  SaveAnalysisPromptTemplateInput,
} from "./types";

export function listAnalysisPromptTemplates(
  taskType: AnalysisTaskType | null = null,
): Promise<AnalysisPromptTemplate[]> {
  return invoke("list_analysis_prompt_templates", {
    input: { taskType },
  });
}

export function saveAnalysisPromptTemplate(
  input: SaveAnalysisPromptTemplateInput,
): Promise<AnalysisPromptTemplate> {
  return invoke("save_analysis_prompt_templates", { input });
}

export function deleteAnalysisPromptTemplate(id: string): Promise<void> {
  return invoke("delete_analysis_prompt_templates", { input: { id } });
}
