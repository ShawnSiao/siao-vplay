/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface LocalResourceMoveResult {
  copiedBytes: number;
  crossVolume: boolean;
  currentRoot: string;
  previousRoot: string;
  previousRootRetained: boolean;
  verifiedFileCount: number;
  [k: string]: unknown;
}
