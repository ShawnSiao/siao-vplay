/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface StorageSettingsView {
  appDataAvailable: boolean;
  appDataFreeSpaceBytes: number | null;
  appDataRoot: string;
  appDataRootLockedByEnvironment: boolean;
  appDataUsedBytes: number;
  defaultSubtitleExportDirectory: string | null;
  defaultVideoReportExportDirectory: string | null;
  mediaCacheAvailable: boolean;
  mediaCacheRoot: string;
  mediaCacheUsedBytes: number;
  mediaCacheUsesDefault: boolean;
  pendingAppDataRoot: string | null;
  remoteMediaAvailable: boolean;
  remoteMediaRoot: string;
  remoteMediaUsedBytes: number;
  remoteMediaUsesDefault: boolean;
  revision: number;
  [k: string]: unknown;
}
