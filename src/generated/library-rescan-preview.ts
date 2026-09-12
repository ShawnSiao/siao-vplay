/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type ItemAvailability = "available" | "missing" | "root_offline" | "changed";
export type EpisodeRecognition =
  | "sxx_exx"
  | "season_x_episode"
  | "chinese_episode"
  | "numeric_prefix"
  | "season_directory"
  | "unresolved"
  | "conflict";

export interface LibraryRescanPreview {
  availableItemCount: number;
  changedItems: LibraryRecoveryItem[];
  collectionId: string;
  expiresAtMs: number;
  ignoredCount: number;
  missingItems: LibraryRecoveryItem[];
  newCandidates: LibraryScanCandidate[];
  previewToken: string;
  rootDisplayName: string;
  rootId: string;
  rootOffline: boolean;
  rootPath: string;
  [k: string]: unknown;
}
export interface LibraryRecoveryItem {
  collectionId: string;
  displayTitle: string;
  previousAvailability: ItemAvailability;
  projectId: string;
  relativePath: string;
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
