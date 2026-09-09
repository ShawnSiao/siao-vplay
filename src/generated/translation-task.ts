/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type Handoff = "manual" | "codex" | "api";
export type TaskStatus =
  | "awaiting_external_result"
  | "queued"
  | "running"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type TaskType = "subtitle_translation";
export type ValidationStatus = "accepted" | "accepted_with_warnings";

export interface TranslationTask {
  authorizedSegmentIds: string[];
  baseTranslationVersionId: string | null;
  completedAtMs: number | null;
  createdAtMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  expectedProjectRevision: number;
  handoffKind: Handoff;
  id: string;
  materialScope: string[];
  outputVersionId: string | null;
  progress: number;
  projectId: string;
  protocolVersion: string;
  receiverLabel: string;
  segmentCount: number;
  sourceLanguageCode: string;
  sourceVersionId: string;
  stage: string;
  startedAtMs: number | null;
  status: TaskStatus;
  targetLanguageCode: string;
  taskType: TaskType;
  updatedAtMs: number;
  validation: TranslationValidation | null;
  [k: string]: unknown;
}
export interface TranslationValidation {
  status: ValidationStatus;
  translationCount: number;
  warningCount: number;
  warnings: string[];
  [k: string]: unknown;
}
