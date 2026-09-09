/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type PreparationState = "ready" | "preparing";

export interface CapabilityPreparation {
  capabilityId: string;
  pendingActionId: string | null;
  readyResourceIds: string[];
  resourceIds: string[];
  state: PreparationState;
  taskIds: string[];
  [k: string]: unknown;
}
