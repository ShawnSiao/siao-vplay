/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface NetworkSettings {
  customProxyUrl: string | null;
  effectiveMode: string;
  effectiveProxyAddress: string | null;
  effectiveSource: string;
  revision: number;
  schemaVersion: number;
  [k: string]: unknown;
}
