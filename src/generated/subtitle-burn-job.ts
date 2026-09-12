/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type SubtitleBurnMode = "translation" | "bilingual";
export type TaskStatus = "queued" | "running" | "validating" | "completed" | "failed" | "cancelled" | "interrupted";

export interface SubtitleBurnJob {
  completedAtMs: number | null;
  createdAtMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  manifestPath: string | null;
  mode: SubtitleBurnMode;
  outputPath: string | null;
  outputSha256: string | null;
  progress: number;
  projectId: string;
  runtimeVersion: string;
  sourceVersionId: string | null;
  stage: string;
  startedAtMs: number | null;
  status: TaskStatus;
  translationVersionId: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
