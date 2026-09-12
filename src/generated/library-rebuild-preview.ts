/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type LibraryRootRebuildMatchKind = "matched" | "missing" | "changed" | "needs_confirmation";
export type ItemAvailability = "available" | "missing" | "root_offline" | "changed";
export type EpisodeRecognition =
  | "sxx_exx"
  | "season_x_episode"
  | "chinese_episode"
  | "numeric_prefix"
  | "season_directory"
  | "unresolved"
  | "conflict";

export interface LibraryRootRebuildPreview {
  changedItems: LibraryRootRebuildItem[];
  currentRootPath: string;
  expiresAtMs: number;
  ignoredCount: number;
  matchedItems: LibraryRootRebuildItem[];
  missingItems: LibraryRootRebuildItem[];
  newCandidates: LibraryScanCandidate[];
  previewToken: string;
  rootDisplayName: string;
  rootId: string;
  rootOffline: boolean;
  rootPath: string;
  suggestedCollectionTitle: string;
  uncertainItems: LibraryRootRebuildItem[];
  [k: string]: unknown;
}
export interface LibraryRootRebuildItem {
  absoluteOrder: number;
  candidateId: string | null;
  displayTitle: string;
  episodeNumber: number | null;
  matchKind: LibraryRootRebuildMatchKind;
  previousAvailability: ItemAvailability;
  projectId: string;
  reason: string | null;
  relativePath: string;
  seasonNumber: number | null;
  [k: string]: unknown;
}
export interface LibraryScanCandidate {
  absoluteOrder: number;
  candidateId: string;
  confirmationReason: string | null;
  displayTitle: string;
  episodeNumber: number | null;
  needsConfirmation: boolean;
  quickFingerprint: string;
  recognition: EpisodeRecognition;
  relativePath: string;
  seasonNumber: number | null;
  sourceModifiedAtMs: number | null;
  sourceSizeBytes: number;
  [k: string]: unknown;
}
