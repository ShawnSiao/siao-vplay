import type { MediaSummary as LibraryMediaSummary } from "../generated/library-section-page";
export type { MediaSummary as LibraryMediaSummary } from "../generated/library-section-page";
export type CollectionKind = "series" | "folder" | "manual";
export type CollectionSortMode = "episode" | "natural" | "manual" | "added_at";
export type LibraryItemAvailability =
  | "available"
  | "missing"
  | "root_offline"
  | "changed";

export type LibraryCollection = {
  id: string;
  kind: CollectionKind;
  title: string;
  rootId: string | null;
  systemKey: "watch_later" | null;
  posterPath: string | null;
  sortMode: CollectionSortMode;
  autoPlayNext: boolean;
  lastOpenedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CollectionSummary = LibraryCollection & {
  itemCount: number;
  seasonCount: number;
  watchedCount: number;
  totalDurationMs: number | null;
};

export type LibraryRootStatus = "linked" | "orphaned" | "ambiguous";

export type LibraryRootSummary = {
  id: string;
  path: string;
  displayName: string;
  availability: "available" | "offline";
  status: LibraryRootStatus;
  lastScannedAtMs: number | null;
  itemCount: number;
};



export type LibraryHome = {
  continueWatching: LibraryMediaSummary[];
  continueWatchingCount?: number;
  collections: CollectionSummary[];
  folders: LibraryRootSummary[];
  unclassified: LibraryMediaSummary[];
  recentlyAdded: LibraryMediaSummary[];
  totalProjectCount: number;
  collectionItemCount: number;
  unclassifiedCount: number;
};

export type LibraryMediaSection =
  | "continue_watching"
  | "watch_later"
  | "unclassified";

export type ListLibrarySectionInput = {
  section: LibraryMediaSection;
  offset: number;
};

export type { LibrarySectionPage } from "../generated/library-section-page";

export type SeasonSummary = {
  seasonNumber: number | null;
  episodeCount: number;
  watchedCount: number;
  totalDurationMs: number | null;
};

export type CollectionDetail = {
  summary: CollectionSummary;
  seasons: SeasonSummary[];
};

export type EpisodeReference = {
  projectId: string;
  displayTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteOrder: number;
};

export type EpisodeNeighbors = {
  previous: EpisodeReference | null;
  next: EpisodeReference | null;
};
