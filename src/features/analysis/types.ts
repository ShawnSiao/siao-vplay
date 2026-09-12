export type { AnalysisTaskType, AnalysisPromptTemplate } from "../../generated/analysis-prompt-template";
import type { AnalysisTaskType } from "../../generated/analysis-prompt-template";

export type AnalysisScope = "current_progress" | "full_video";

export type AnalysisMode =
  | "automatic"
  | "general"
  | "science_technology"
  | "software_architecture";

export type { PromptSelection } from "../../types";

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
