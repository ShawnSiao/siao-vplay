/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface ResourceRollbackResult {
  activeVersion: string;
  previousVersion: string;
  resourceId: string;
  [k: string]: unknown;
}
