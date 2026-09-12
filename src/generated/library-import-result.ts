/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type CollectionKind = "series" | "folder" | "manual";
export type CollectionSortMode = "episode" | "natural" | "manual" | "added_at";
export type CollectionSystemKey = "watch_later";

export interface LibraryImportResult {
  collection: CollectionDetail;
  createdProjectCount: number;
  importedItemCount: number;
  reusedProjectCount: number;
  rootId: string;
  [k: string]: unknown;
}
export interface CollectionDetail {
  seasons: SeasonSummary[];
  summary: CollectionSummary;
  [k: string]: unknown;
}
export interface SeasonSummary {
  episodeCount: number;
  seasonNumber: number | null;
  totalDurationMs: number | null;
  watchedCount: number;
  [k: string]: unknown;
}
export interface CollectionSummary {
  autoPlayNext: boolean;
  createdAtMs: number;
  id: string;
  itemCount: number;
  kind: CollectionKind;
  lastOpenedAtMs: number | null;
  posterPath: string | null;
  rootId: string | null;
  seasonCount: number;
  sortMode: CollectionSortMode;
  systemKey: CollectionSystemKey | null;
  title: string;
  totalDurationMs: number | null;
  updatedAtMs: number;
  watchedCount: number;
  [k: string]: unknown;
}
