/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface UnusedResourceCleanupResult {
  reclaimedBytes: number;
  removedResourceIds: string[];
  [k: string]: unknown;
}
