/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type CollectionKind = "series" | "folder" | "manual";
export type CollectionSortMode = "episode" | "natural" | "manual" | "added_at";
export type CollectionSystemKey = "watch_later";
export type OverviewScope = "collections" | "roots";

export interface CollectionOverviewPage {
  /**
   * @maxItems 24
   */
  items: CollectionSummary[];
  nextOffset: number | null;
  offset: number;
  query: string;
  rootLinked: boolean;
  scope: OverviewScope;
  snapshotToken: string;
  totalCount: number;
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
