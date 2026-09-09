/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type ItemAvailability = "available" | "missing" | "root_offline" | "changed";

export interface LibrarySectionPage {
  items: MediaSummary[];
  nextOffset: number | null;
  totalCount: number;
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
