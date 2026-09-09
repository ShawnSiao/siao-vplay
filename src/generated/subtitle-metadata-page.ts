/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type SubtitleTrackRole = "original" | "translation";
export type SubtitleRevisionStatus = "draft" | "ready" | "rejected";

export interface SubtitleMetadataPage {
  /**
   * @maxItems 24
   */
  items: SubtitleVersionMetadata[];
  nextOffset: number | null;
  offset: number;
  projectId: string;
  snapshotToken: string;
  totalCount: number;
}
export interface SubtitleVersionMetadata {
  createdAtMs: number;
  id: string;
  isCurrent: boolean;
  languageCode: string;
  projectId: string;
  role: SubtitleTrackRole;
  segmentCount: number;
  sourceLabel: string;
  status: SubtitleRevisionStatus;
  trackId: string;
  versionNumber: number;
}
