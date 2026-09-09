import type { StorageSettings } from "../types";
export const storageSettingsFixture: StorageSettings = {
  revision: 1, appDataRoot: "W:/data", appDataRootLockedByEnvironment: false,
  remoteMediaRoot: "W:/data/remote-media", remoteMediaUsesDefault: true,
  mediaCacheRoot: "W:/data/media-cache", mediaCacheUsesDefault: true,
  defaultSubtitleExportDirectory: null, defaultVideoReportExportDirectory: null,
  appDataUsedBytes: 0, appDataFreeSpaceBytes: 100000, remoteMediaUsedBytes: 0, mediaCacheUsedBytes: 0,
  appDataAvailable: true, remoteMediaAvailable: true, mediaCacheAvailable: true, pendingAppDataRoot: null,
};
