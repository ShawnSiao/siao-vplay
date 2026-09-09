export type { MediaSummary as LibraryMediaSummary } from "../generated/library-section-page";
export type CollectionKind = "series" | "folder" | "manual";
export type CollectionSortMode = "episode" | "natural" | "manual" | "added_at";
export type LibraryItemAvailability =
  | "available"
  | "missing"
  | "root_offline"
  | "changed";

import type { Collection as LibraryCollection } from "../generated/library-collection";
export type { Collection as LibraryCollection } from "../generated/library-collection";

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



export type { LibraryHome } from "../generated/library-home";

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

export type { CollectionDetail } from "../generated/collection-detail";

export type { EpisodeReference, EpisodeNeighbors } from "../generated/episode-neighbors-result";
