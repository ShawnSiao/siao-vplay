/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface LocalResourceMoveResult {
  copiedBytes: number;
  crossVolume: boolean;
  currentRoot: string;
  planFingerprint: string;
  previousRoot: string;
  previousRootRetained: boolean;
  requestId: string;
  verifiedFileCount: number;
  [k: string]: unknown;
}
