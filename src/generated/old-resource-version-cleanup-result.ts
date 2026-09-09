/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface OldResourceVersionCleanupResult {
  interruption: CleanupInterruption | null;
  reclaimedBytes: number;
  removedVersions: string[];
  [k: string]: unknown;
}
export interface CleanupInterruption {
  itemId: string;
  message: string;
  /**
   * @minItems 1
   */
  remainingItemIds: [string, ...string[]];
  [k: string]: unknown;
}
