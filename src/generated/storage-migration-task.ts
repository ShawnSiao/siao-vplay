/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type StorageArea = "app_data" | "remote_media" | "media_cache";
export type StorageMigrationMode = "copy" | "rebuild";
export type StorageMigrationStatus =
  "prepared" | "running" | "interrupted" | "cancelled" | "failed" | "completed" | "restart_required";

export interface StorageMigrationTask {
  area: StorageArea;
  bytesToCopy: number;
  copiedBytes: number;
  createdAtMs: number;
  destinationRoot: string;
  errorCode: string | null;
  errorMessage: string | null;
  fileCount: number;
  freeSpaceBytes: number | null;
  id: string;
  mode: StorageMigrationMode;
  previousRootRetained: boolean;
  restartRequired: boolean;
  sourceRoot: string;
  status: StorageMigrationStatus;
  updatedAtMs: number;
  verifiedFileCount: number;
  [k: string]: unknown;
}
