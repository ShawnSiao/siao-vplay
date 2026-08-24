export type StorageArea = "app_data" | "remote_media" | "media_cache";
export type StorageMigrationMode = "copy" | "rebuild";
export type StorageMigrationStatus =
  | "prepared"
  | "running"
  | "interrupted"
  | "cancelled"
  | "failed"
  | "completed"
  | "restart_required";

export type StorageMigrationTask = {
  id: string;
  area: StorageArea;
  mode: StorageMigrationMode;
  status: StorageMigrationStatus;
  sourceRoot: string;
  destinationRoot: string;
  bytesToCopy: number;
  copiedBytes: number;
  fileCount: number;
  verifiedFileCount: number;
  freeSpaceBytes: number | null;
  previousRootRetained: boolean;
  restartRequired: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type StorageLocationKind =
  | StorageArea
  | "subtitle_export"
  | "video_report_export";
