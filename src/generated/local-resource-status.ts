/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type LocalResourceCapabilityState =
  "setup_required" | "not_ready" | "preparing" | "ready" | "repair_required" | "root_unavailable" | "update_available";
export type LocalResourceRootState = "setup_required" | "ready" | "root_unavailable" | "repair_required";

export interface LocalResourceStatus {
  capabilities: LocalResourceCapabilityStatus[];
  configured: boolean;
  freeSpaceBytes: number | null;
  preferredProfile: string;
  resourceRoot: string | null;
  rootState: LocalResourceRootState;
  selectedParent: string | null;
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
