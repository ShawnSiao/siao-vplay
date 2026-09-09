/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type RelocationMismatchReason = "missing" | "fingerprint_changed" | "invalid_relative_path";

export interface LibraryRootRelocationPreview {
  currentRootPath: string;
  expiresAtMs: number;
  matchedItemCount: number;
  mismatches: LibraryRelocationMismatch[];
  newRootPath: string;
  previewToken: string;
  rootId: string;
  [k: string]: unknown;
}
export interface LibraryRelocationMismatch {
  projectId: string;
  reason: RelocationMismatchReason;
  relativePath: string;
  [k: string]: unknown;
}
