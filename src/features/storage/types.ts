import type { StorageMigrationTask } from "../../generated/storage-migration-task";
export type { StorageMigrationTask };
export type StorageArea = StorageMigrationTask["area"];
export type StorageMigrationMode = StorageMigrationTask["mode"];
export type StorageMigrationStatus = StorageMigrationTask["status"];

export type StorageLocationKind =
  | StorageArea
  | "subtitle_export"
  | "video_report_export";
