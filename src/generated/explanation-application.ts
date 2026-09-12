/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type AiExecutionKind = "manual" | "codex" | "api";
export type TaskStatus =
  | "awaiting_external_result"
  | "queued"
  | "running"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ExplanationApplication {
  explanation: Explanation;
  task: ExplanationTask;
  [k: string]: unknown;
}
export interface Explanation {
  confirmedFacts: ExplanationEntry[];
  createdAtMs: number;
  id: string;
  materialSummary: ExplanationMaterialSummary;
  playbackCutoffMs: number;
  possibleInterpretations: ExplanationEntry[];
  projectId: string;
  protocolVersion: string;
  sceneStartMs: number;
  sourceVersionId: string;
  taskId: string;
  translationVersionId: string | null;
  withheldReason: string | null;
  [k: string]: unknown;
}
export interface ExplanationEntry {
  frameIds: string[];
  subtitleSegmentIds: string[];
  text: string;
  [k: string]: unknown;
}
export interface ExplanationMaterialSummary {
  endMs: number;
  frameCount: number;
  startMs: number;
  subtitleCount: number;
  [k: string]: unknown;
}
export interface ExplanationTask {
  authorizedSegmentIds: string[];
  completedAtMs: number | null;
  createdAtMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  execution: AiTaskExecutionInfo;
  expectedProjectRevision: number;
  frames: ExplanationFrame[];
  handoffKind: AiExecutionKind;
  id: string;
  materialScope: string[];
  materialSummary: ExplanationMaterialSummary;
  outputExplanationId: string | null;
  playbackCutoffMs: number;
  progress: number;
  projectId: string;
  protocolVersion: string;
  receiverLabel: string;
  sceneStartMs: number;
  sourceVersionId: string;
  stage: string;
  startedAtMs: number | null;
  status: TaskStatus;
  translationVersionId: string | null;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface AiTaskExecutionInfo {
  kind: AiExecutionKind;
  modelId: string | null;
  providerId: string | null;
  providerRequestId: string | null;
  serviceConfigId: string | null;
  serviceRevision: number | null;
  usage: unknown;
  [k: string]: unknown;
}
export interface ExplanationFrame {
  id: string;
  ordinal: number;
  path: string;
  sha256: string;
  timestampMs: number;
  [k: string]: unknown;
}
