/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type MediaPreparationStage =
  "queued" | "runtime" | "fingerprint" | "inspect" | "transcode" | "validate" | "finalize";
export type MediaPreparationStatus = "running" | "cancelling" | "completed" | "cancelled" | "failed";

export interface MediaPreparationProgress {
  projectId: string;
  requestId: string;
  stage: MediaPreparationStage;
  status: MediaPreparationStatus;
  [k: string]: unknown;
}
