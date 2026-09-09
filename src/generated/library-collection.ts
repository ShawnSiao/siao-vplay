/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type CollectionKind = "series" | "folder" | "manual";
export type CollectionSortMode = "episode" | "natural" | "manual" | "added_at";
export type CollectionSystemKey = "watch_later";

export interface Collection {
  autoPlayNext: boolean;
  createdAtMs: number;
  id: string;
  kind: CollectionKind;
  lastOpenedAtMs: number | null;
  posterPath: string | null;
  rootId: string | null;
  sortMode: CollectionSortMode;
  systemKey: CollectionSystemKey | null;
  title: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
