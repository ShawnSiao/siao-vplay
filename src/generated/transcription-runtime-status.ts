/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface TranscriptionRuntimeStatus {
  available: boolean;
  models: TranscriptionModelStatus[];
  preferredBackend: string | null;
  runtimes: TranscriptionRuntimeOption[];
  [k: string]: unknown;
}
export interface TranscriptionModelStatus {
  available: boolean;
  errorMessage: string | null;
  modelKind: string;
  path: string | null;
  [k: string]: unknown;
}
export interface TranscriptionRuntimeOption {
  available: boolean;
  backend: string;
  errorMessage: string | null;
  path: string | null;
  version: string | null;
  [k: string]: unknown;
}
