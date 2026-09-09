/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface CodexRuntimeStatus {
  authMode: string | null;
  authenticated: boolean;
  available: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  minimumVersion: string;
  supported: boolean;
  version: string | null;
  [k: string]: unknown;
}
