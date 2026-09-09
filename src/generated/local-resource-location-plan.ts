/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface LocalResourceLocationPlan {
  confirmationRequired: boolean;
  freeSpaceBytes: number | null;
  parentExists: boolean;
  resourceRoot: string;
  resourceRootExists: boolean;
  selectedParent: string;
  [k: string]: unknown;
}
