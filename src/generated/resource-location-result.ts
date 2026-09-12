/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type LocalResourceCapabilityState =
  "setup_required" | "not_ready" | "preparing" | "ready" | "repair_required" | "root_unavailable" | "update_available";
export type LocalResourceRootState = "setup_required" | "ready" | "root_unavailable" | "repair_required";
export type ResourceDownloadTaskState =
  "queued" | "downloading" | "paused" | "verifying" | "installing" | "completed" | "failed" | "cancelled";

export interface ResourceLocationResult {
  bindingError: string | null;
  capabilities: LocalResourceCapabilityStatus[];
  configurationFingerprint: string;
  configured: boolean;
  freeSpaceBytes: number | null;
  preferredProfile: string;
  resourceRoot: string | null;
  rootState: LocalResourceRootState;
  selectedParent: string | null;
  /**
   * Orders snapshots within one backend process; not stored in user configuration.
   */
  snapshotRevision: number;
  taskSnapshot: ResourceDownloadSnapshot | null;
  [k: string]: unknown;
}
export interface LocalResourceCapabilityStatus {
  id: string;
  missingResourceIds: string[];
  requiredResourceIds: string[];
  state: LocalResourceCapabilityState;
  title: string;
  [k: string]: unknown;
}
export interface ResourceDownloadSnapshot {
  generation: number;
  tasks: ResourceDownloadTask[];
  [k: string]: unknown;
}
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
