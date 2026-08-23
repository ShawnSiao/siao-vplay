export type AnalysisTaskType = "understanding" | "summary";

export type AnalysisScope = "current_progress" | "full_video";

export type AnalysisMode =
  | "automatic"
  | "general"
  | "science_technology"
  | "software_architecture";

export interface AnalysisPromptTemplate {
  id: string;
  taskType: AnalysisTaskType;
  baseTemplateId: string;
  name: string;
  customRequirements: string;
  isBuiltin: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface PromptSelection {
  templateId: string;
  oneTimeRequirements: string;
}

export interface PromptSnapshot {
  schemaVersion: number;
  taskType: AnalysisTaskType;
  systemRulesVersion: string;
  templateId: string;
  templateName: string;
  baseTemplateId: string;
  templateRequirements: string;
  oneTimeRequirements: string;
  composedPrompt: string;
  sha256: string;
}

export interface SaveAnalysisPromptTemplateInput {
  id: string | null;
  taskType: AnalysisTaskType;
  baseTemplateId: string;
  name: string;
  customRequirements: string;
}
