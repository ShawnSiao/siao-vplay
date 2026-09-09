/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface UnusedResourceCleanupPlan {
  confirmationRequired: boolean;
  reclaimableBytes: number;
  resourceIds: string[];
  [k: string]: unknown;
}
