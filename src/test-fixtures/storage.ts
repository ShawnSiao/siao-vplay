import type { StorageMigrationTask } from "../features/storage/types";
import type { StorageSettings } from "../types";
export const storageSettingsFixture: StorageSettings = {
  revision: 1, appDataRoot: "W:/data", appDataRootLockedByEnvironment: false,
  remoteMediaRoot: "W:/data/remote-media", remoteMediaUsesDefault: true,
  mediaCacheRoot: "W:/data/media-cache", mediaCacheUsesDefault: true,
  defaultSubtitleExportDirectory: null, defaultVideoReportExportDirectory: null,
  appDataUsedBytes: 0, appDataFreeSpaceBytes: 100000, remoteMediaUsedBytes: 0, mediaCacheUsedBytes: 0,
  appDataAvailable: true, remoteMediaAvailable: true, mediaCacheAvailable: true, pendingAppDataRoot: null,
};

export const storageMigrationFixture: StorageMigrationTask = {
  id: "migration", area: "remote_media", mode: "copy", status: "completed", sourceRoot: "W:/old", destinationRoot: "W:/new",
  bytesToCopy: 1, copiedBytes: 1, fileCount: 1, verifiedFileCount: 1, freeSpaceBytes: 100,
  previousRootRetained: true, restartRequired: false, errorCode: null, errorMessage: null, createdAtMs: 1, updatedAtMs: 2,
};
