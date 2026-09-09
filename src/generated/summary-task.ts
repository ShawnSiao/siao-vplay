/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type AnalysisMode = "automatic" | "general" | "science_technology" | "software_architecture";
export type ChunkStatus = "prepared" | "queued" | "running" | "completed" | "failed" | "cancelled";
export type SummaryExecutionKind = "manual" | "codex" | "api";
export type AnalysisTaskType = "understanding" | "summary";
export type AnalysisScope = "current_progress" | "full_video";
export type TaskStatus =
  | "prepared"
  | "awaiting_external_result"
  | "queued"
  | "running"
  | "paused"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface SummaryTask {
  analysisMode: AnalysisMode;
  cancelRequested: boolean;
  chunks: SummaryChunk[];
  createdAtMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  executionKind: SummaryExecutionKind;
  id: string;
  materialManifestSha256: string;
  materialsDirectory: string;
  modelId: string | null;
  outputSummaryId: string | null;
  playbackCutoffMs: number | null;
  progress: number;
  projectId: string;
  promptSnapshot: PromptSnapshot;
  providerId: string | null;
  scope: AnalysisScope;
  serviceConfigId: string | null;
  serviceRevision: number | null;
  spoilerConfirmed: boolean;
  stage: string;
  status: TaskStatus;
  subtitleVersionId: string;
  updatedAtMs: number;
  visualMaterialAuthorized: boolean;
  [k: string]: unknown;
}
export interface SummaryChunk {
  contextSegmentIds: string[];
  endMs: number;
  id: string;
  ordinal: number;
  retryCount: number;
  segmentIds: string[];
  startMs: number;
  status: ChunkStatus;
  [k: string]: unknown;
}
export interface PromptSnapshot {
  baseTemplateId: string;
  composedPrompt: string;
  oneTimeRequirements: string;
  schemaVersion: number;
  sha256: string;
  systemRulesVersion: string;
  taskType: AnalysisTaskType;
  templateId: string;
  templateName: string;
  templateRequirements: string;
  [k: string]: unknown;
}
