/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type ResourceDownloadTaskState =
  "queued" | "downloading" | "paused" | "verifying" | "installing" | "completed" | "failed" | "cancelled";

export interface ResourceDownloadTask {
  attempt: number;
  createdAtMs: number;
  downloadedBytes: number;
  errorCode: string | null;
  errorMessage: string | null;
  forceReinstall: boolean;
  id: string;
  pendingActionIds: string[];
  requestedByCapabilityIds: string[];
  resourceId: string;
  state: ResourceDownloadTaskState;
  totalBytes: number;
  updatedAtMs: number;
  version: string;
  [k: string]: unknown;
}
