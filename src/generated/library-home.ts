/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type CollectionKind = "series" | "folder" | "manual";
export type CollectionSortMode = "episode" | "natural" | "manual" | "added_at";
export type CollectionSystemKey = "watch_later";
export type ItemAvailability = "available" | "missing" | "root_offline" | "changed";
export type RootAvailability = "available" | "offline";
export type LibraryRootStatus = "linked" | "orphaned" | "ambiguous";

export interface LibraryHome {
  collectionItemCount: number;
  collections: CollectionSummary[];
  continueWatching: MediaSummary[];
  continueWatchingCount: number;
  folders: LibraryRootSummary[];
  recentlyAdded: MediaSummary[];
  totalProjectCount: number;
  unclassified: MediaSummary[];
  unclassifiedCount: number;
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
export interface MediaSummary {
  absoluteOrder: number | null;
  chineseTranslationAvailable: boolean;
  collectionId: string | null;
  collectionTitle: string | null;
  completedAtMs: number | null;
  createdAtMs: number;
  displayName: string;
  durationMs: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  itemAvailability: ItemAvailability | null;
  lastOpenedAtMs: number;
  mediaAvailable: boolean;
  mediaLocator: string;
  originalSubtitleAvailable: boolean;
  positionMs: number;
  posterPath: string | null;
  projectId: string;
  projectTitle: string;
  seasonNumber: number | null;
  [k: string]: unknown;
}
export interface LibraryRootSummary {
  availability: RootAvailability;
  displayName: string;
  id: string;
  itemCount: number;
  lastScannedAtMs: number | null;
  path: string;
  status: LibraryRootStatus;
  [k: string]: unknown;
}
