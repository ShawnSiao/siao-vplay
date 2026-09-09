/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface SaveStorageSettingsInput {
  defaultSubtitleExportDirectory: string | null;
  defaultVideoReportExportDirectory: string | null;
  expectedRevision: number;
  mediaCacheRoot: string | null;
  remoteMediaRoot: string | null;
  [k: string]: unknown;
}
