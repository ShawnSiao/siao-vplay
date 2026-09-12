/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type AiExecutionKind = "manual" | "codex" | "api";
export type Handoff = "manual" | "codex" | "api";
export type SelectionKind = "word" | "phrase" | "sentence";
export type TaskStatus =
  | "awaiting_external_result"
  | "queued"
  | "running"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface LearningTask {
  completedAtMs: number | null;
  createdAtMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  execution: AiTaskExecutionInfo;
  expectedProjectRevision: number;
  handoffKind: Handoff;
  id: string;
  materialScope: string[];
  outputDictionaryEntryId: string | null;
  playbackPositionMs: number;
  progress: number;
  projectId: string;
  protocolVersion: string;
  receiverLabel: string;
  selectedText: string;
  selectionKind: SelectionKind;
  sourceSegmentId: string;
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
