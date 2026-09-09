/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type LibraryScanPhase = "scanning" | "fingerprinting" | "completed" | "cancelled" | "failed";

export interface LibraryScanProgress {
  candidateFiles: number;
  currentRelativePath: string | null;
  ignoredEntries: number;
  message: string | null;
  phase: LibraryScanPhase;
  scanId: string;
  scannedDirectories: number;
  scannedFiles: number;
  [k: string]: unknown;
}
