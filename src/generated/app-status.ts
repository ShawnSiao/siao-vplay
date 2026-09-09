/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface AppStatus {
  appName: string;
  dataDirectory: string;
  platform: string;
  startupMediaPath: string | null;
  version: string;
  [k: string]: unknown;
}
