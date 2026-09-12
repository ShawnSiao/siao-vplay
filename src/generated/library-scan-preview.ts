/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type EpisodeRecognition =
  | "sxx_exx"
  | "season_x_episode"
  | "chinese_episode"
  | "numeric_prefix"
  | "season_directory"
  | "unresolved"
  | "conflict";
export type IgnoredEntryReason =
  | "hidden"
  | "system"
  | "reparse_point"
  | "ignored_name"
  | "temporary"
  | "unsupported_extension"
  | "outside_root"
  | "unreadable";

export interface LibraryScanPreview {
  candidates: LibraryScanCandidate[];
  expiresAtMs: number;
  ignoredCount: number;
  ignoredEntries: IgnoredLibraryEntry[];
  needsConfirmationCount: number;
  previewToken: string;
  rootDisplayName: string;
  rootPath: string;
  scanId: string;
  suggestedCollectionTitle: string;
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
export interface IgnoredLibraryEntry {
  reason: IgnoredEntryReason;
  relativePath: string;
  [k: string]: unknown;
}
