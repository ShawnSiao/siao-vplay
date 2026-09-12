/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type AnalysisTaskType = "understanding" | "summary";

export interface AnalysisPromptTemplate {
  baseTemplateId: string;
  createdAtMs: number;
  customRequirements: string;
  id: string;
  isBuiltin: boolean;
  name: string;
  taskType: AnalysisTaskType;
  updatedAtMs: number;
  [k: string]: unknown;
}
