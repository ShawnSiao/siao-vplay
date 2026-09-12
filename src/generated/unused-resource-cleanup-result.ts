/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface UnusedResourceCleanupResult {
  interruption: CleanupInterruption | null;
  reclaimedBytes: number;
  removedResourceIds: string[];
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
