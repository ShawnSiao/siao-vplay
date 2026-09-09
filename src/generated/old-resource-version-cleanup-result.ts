/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface OldResourceVersionCleanupResult {
  reclaimedBytes: number;
  removedVersions: string[];
  [k: string]: unknown;
}
