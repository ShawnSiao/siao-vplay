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
  /**
   * Process-local root binding and mutation order, reissued when the store loads.
   */
  generation: number;
  id: string;
  pendingActionIds: string[];
  requestedByCapabilityIds: string[];
  resourceId: string;
  revision: number;
  state: ResourceDownloadTaskState;
  totalBytes: number;
  updatedAtMs: number;
  version: string;
  [k: string]: unknown;
}
