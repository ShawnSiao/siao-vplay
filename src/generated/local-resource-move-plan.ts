/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface LocalResourceMovePlan {
  bytesToCopy: number;
  confirmationRequired: boolean;
  crossVolume: boolean;
  destinationExists: boolean;
  fileCount: number;
  freeSpaceBytes: number | null;
  planFingerprint: string;
  previousRoot: string;
  resourceRoot: string;
  selectedParent: string;
  [k: string]: unknown;
}
