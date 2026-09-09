/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface MediaRuntimeStatus {
  available: boolean;
  errorMessage: string | null;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  version: string | null;
  [k: string]: unknown;
}
