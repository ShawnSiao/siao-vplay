/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface DeleteProjectResult {
  cachedMediaDeleted: boolean;
  cleanupPending: number;
  deleted: boolean;
  projectId: string;
  sourceMediaDeleted: boolean;
  [k: string]: unknown;
}
