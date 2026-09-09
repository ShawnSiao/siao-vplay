/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface ResourceRemovalResult {
  affectedCapabilityIds: string[];
  removed: boolean;
  resourceId: string;
  [k: string]: unknown;
}
