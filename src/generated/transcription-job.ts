/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type TranscriptionLanguage = "auto" | "en" | "th" | "ja" | "ko";
export type TranscriptionModelKind = "small" | "base";
export type TranscriptionBackend = "vulkan" | "cpu";
export type TranscriptionStatus =
  "queued" | "extracting" | "transcribing" | "validating" | "completed" | "failed" | "cancelled" | "interrupted";

export interface TranscriptionJob {
  completedAtMs: number | null;
  createdAtMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  languageCode: TranscriptionLanguage;
  modelKind: TranscriptionModelKind;
  progress: number;
  projectId: string;
  runtimeBackend: TranscriptionBackend;
  runtimeVersion: string;
  stage: string;
  startedAtMs: number | null;
  status: TranscriptionStatus;
  subtitleVersionId: string | null;
  updatedAtMs: number;
  [k: string]: unknown;
}
