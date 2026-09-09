export interface PromptSelection {
  templateId: string;
  oneTimeRequirements: string;
}

export type { ExplanationFrame, ExplanationTask, ExplanationMaterialSummary } from "./generated/explanation-task";
export type { Explanation, ExplanationEntry } from "./generated/explanation";
export type { ExplanationApplication } from "./generated/explanation-application";
import type { SubtitlePreflightReport } from "./generated/subtitle-version";
export type { SubtitleIssueSeverity, SubtitleIssueCode, SubtitlePreflightIssue, SubtitlePreflightReport, SubtitleWord, SubtitleSegment, SubtitleVersion } from "./generated/subtitle-version";
import type {
  CollectionDetail,
  LibraryItemAvailability,
  LibraryRootStatus,
  LibraryRootSummary,
} from "./lib/libraryTypes";

export type {
  CollectionDetail,
  CollectionKind,
  CollectionSortMode,
  CollectionSummary,
  EpisodeNeighbors,
  EpisodeReference,
  LibraryCollection,
  LibraryHome,
  LibraryItemAvailability,
  LibraryMediaSection,
  LibraryMediaSummary,
  LibraryRootStatus,
  LibraryRootSummary,
  LibrarySectionPage,
  ListLibrarySectionInput,
  SeasonSummary,
} from "./lib/libraryTypes";

export type { AppStatus } from "./generated/app-status";

export type ProjectStatus = "ready" | "needs_relink";

export type MediaSource = {
  id: string;
  kind: "local_file";
  locator: string;
  originUrl: string | null;
  displayName: string;
  isAvailable: boolean;
  sourceSha256: string | null;
  probedAtMs: number | null;
  posterPath: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type PlaybackState = {
  positionMs: number;
  durationMs: number | null;
  completedAtMs: number | null;
  volume: number;
  playbackRate: number;
  subtitleMode: SubtitleDisplayMode;
  updatedAtMs: number;
};

export type SubtitleDisplayMode = "original" | "translation" | "bilingual";

export type { Project } from "./generated/project";

export type { SearchResult as LibrarySearchResult } from "./generated/library-search-result";

export type EpisodeRecognition =
  | "sxx_exx"
  | "season_x_episode"
  | "chinese_episode"
  | "numeric_prefix"
  | "season_directory"
  | "unresolved"
  | "conflict";

export type LibraryScanCandidate = {
  candidateId: string;
  relativePath: string;
  displayTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteOrder: number;
  recognition: EpisodeRecognition;
  needsConfirmation: boolean;
  confirmationReason: string | null;
  sourceSizeBytes: number;
  sourceModifiedAtMs: number | null;
  quickFingerprint: string;
};

export type IgnoredLibraryEntry = {
  relativePath: string;
  reason:
    | "hidden"
    | "system"
    | "reparse_point"
    | "ignored_name"
    | "temporary"
    | "unsupported_extension"
    | "outside_root"
    | "unreadable";
};

export type LibraryScanPhase =
  | "scanning"
  | "fingerprinting"
  | "completed"
  | "cancelled"
  | "failed";

export type LibraryScanProgress = {
  scanId: string;
  phase: LibraryScanPhase;
  scannedDirectories: number;
  scannedFiles: number;
  candidateFiles: number;
  ignoredEntries: number;
  currentRelativePath: string | null;
  message: string | null;
};

export type LibraryScanPreview = {
  scanId: string;
  previewToken: string;
  rootPath: string;
  rootDisplayName: string;
  suggestedCollectionTitle: string;
  candidates: LibraryScanCandidate[];
  ignoredEntries: IgnoredLibraryEntry[];
  ignoredCount: number;
  needsConfirmationCount: number;
  expiresAtMs: number;
};

export type ConfirmLibraryItemInput = {
  candidateId: string;
  displayTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteOrder: number;
  confirmed: boolean;
};

export type ConfirmLibraryImportInput = {
  previewToken: string;
  collectionTitle: string;
  items: ConfirmLibraryItemInput[];
  confirmFingerprintDuplicates: boolean;
};

export type LibraryImportResult = {
  rootId: string;
  collection: CollectionDetail;
  importedItemCount: number;
  createdProjectCount: number;
  reusedProjectCount: number;
};

export type LibraryRecoveryItem = {
  collectionId: string;
  projectId: string;
  relativePath: string;
  displayTitle: string;
  previousAvailability: LibraryItemAvailability;
};

export type LibraryRescanPreview = {
  previewToken: string;
  rootId: string;
  rootPath: string;
  rootDisplayName: string;
  collectionId: string;
  rootOffline: boolean;
  newCandidates: LibraryScanCandidate[];
  missingItems: LibraryRecoveryItem[];
  changedItems: LibraryRecoveryItem[];
  availableItemCount: number;
  ignoredCount: number;
  expiresAtMs: number;
};

export type ApplyLibraryRescanInput = {
  previewToken: string;
  newItems: ConfirmLibraryItemInput[];
  confirmMissing: boolean;
  confirmChanged: boolean;
  confirmFingerprintDuplicates: boolean;
};

export type LibraryRescanResult = {
  root: LibraryRootSummary;
  collection: CollectionDetail;
  addedItemCount: number;
  createdProjectCount: number;
  reusedProjectCount: number;
  missingItemCount: number;
  changedItemCount: number;
  availableItemCount: number;
};

export type RelocationMismatchReason =
  | "missing"
  | "fingerprint_changed"
  | "invalid_relative_path";

export type LibraryRelocationMismatch = {
  projectId: string;
  relativePath: string;
  reason: RelocationMismatchReason;
};

export type LibraryRootRelocationPreview = {
  previewToken: string;
  rootId: string;
  currentRootPath: string;
  newRootPath: string;
  matchedItemCount: number;
  mismatches: LibraryRelocationMismatch[];
  expiresAtMs: number;
};

export type LibraryRootRelocationResult = {
  root: LibraryRootSummary;
  updatedItemCount: number;
};

export type LibraryCollectionDeletionResult = {
  collectionId: string;
  rootId: string | null;
  preservedProjectCount: number;
  rootStatus: LibraryRootStatus | null;
};

export type LibraryRootRebuildMatchKind =
  | "matched"
  | "missing"
  | "changed"
  | "needs_confirmation";

export type LibraryRootRebuildItem = {
  projectId: string;
  candidateId: string | null;
  relativePath: string;
  displayTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteOrder: number;
  previousAvailability: LibraryItemAvailability;
  matchKind: LibraryRootRebuildMatchKind;
  reason: string | null;
};

export type LibraryRootRebuildPreview = {
  previewToken: string;
  rootId: string;
  currentRootPath: string;
  rootPath: string;
  rootDisplayName: string;
  suggestedCollectionTitle: string;
  rootOffline: boolean;
  newCandidates: LibraryScanCandidate[];
  matchedItems: LibraryRootRebuildItem[];
  missingItems: LibraryRootRebuildItem[];
  changedItems: LibraryRootRebuildItem[];
  uncertainItems: LibraryRootRebuildItem[];
  ignoredCount: number;
  expiresAtMs: number;
};

export type InspectLibraryRootRebuildInput = {
  rootId: string;
  newRootPath: string | null;
};

export type ApplyLibraryRootRebuildInput = {
  previewToken: string;
  collectionTitle: string;
  newItems: ConfirmLibraryItemInput[];
  confirmMissing: boolean;
  confirmChanged: boolean;
  confirmUncertainMatches: boolean;
  confirmFingerprintDuplicates: boolean;
};

export type LibraryRootRebuildResult = {
  root: LibraryRootSummary;
  collection: CollectionDetail;
  restoredItemCount: number;
  addedItemCount: number;
  createdProjectCount: number;
  reusedProjectCount: number;
  missingItemCount: number;
  changedItemCount: number;
};

export type LibraryRootRevokeResult = {
  rootId: string;
  detachedCollectionCount: number;
  preservedProjectCount: number;
};

export type MediaArtifactStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type MediaArtifact = {
  id: string;
  projectId: string;
  sourceMediaId: string;
  status: MediaArtifactStatus;
  path: string;
  sourceSha256: string;
  profile: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type VideoStream = {
  index: number;
  codecName: string;
  profile: string | null;
  pixelFormat: string | null;
  width: number;
  height: number;
  frameRate: number | null;
  durationMs: number | null;
};

export type AudioStream = {
  index: number;
  codecName: string;
  channels: number | null;
  sampleRateHz: number | null;
  durationMs: number | null;
};

export type SubtitleStream = {
  index: number;
  codecName: string;
  language: string | null;
  kind: "text" | "image" | "unknown";
};

export type MediaProbe = {
  containerFormats: string[];
  durationMs: number | null;
  sizeBytes: number | null;
  bitRate: number | null;
  videoStreams: VideoStream[];
  audioStreams: AudioStream[];
  subtitleStreams: SubtitleStream[];
};

export type PlaybackDecision =
  | "direct"
  | "runtime_validation_required"
  | "proxy_required"
  | "unsupported";

export type MediaInspection = {
  projectId: string;
  mediaSourceId: string;
  sourceSha256: string;
  probe: MediaProbe;
  playbackGate: {
    decision: PlaybackDecision;
    reasonCodes: string[];
    requiresRuntimeVideoCheck: boolean;
  };
  ffmpegVersion: string;
  reusedProbe: boolean;
};

export type { MediaPreparation } from "./generated/media-preparation-result";



export type RuntimeSettings = {
  storageRoot: string | null;
  preferredModel: "small" | "base";
};

export type RuntimeComponent = {
  id: string;
  title: string;
  componentKind: "bundled" | "download";
  version: string;
  available: boolean;
  installedPath: string | null;
  expectedSizeBytes: number;
  installedSizeBytes: number | null;
  expectedSha256: string;
  sourceUrl: string;
  sourcePage: string;
  license: string;
  errorMessage: string | null;
};

export type RuntimeCatalog = {
  settings: RuntimeSettings;
  components: RuntimeComponent[];
};

export type { LocalResourceRootState, LocalResourceCapabilityState, LocalResourceCapabilityStatus, LocalResourceStatus } from "./generated/local-resource-status";

export type { LocalResourceLocationPlan } from "./generated/local-resource-location-plan";

export type { ResourceArtifact as LocalResourceArtifact, ResourceDefinition as LocalResourceDefinition, LocalResourceCatalog } from "./generated/local-resource-catalog";

export type { ResourceDownloadTaskState, ResourceDownloadTask } from "./generated/resource-download-task";

export type { ResourceNetworkStatus } from "./generated/resource-network-status";

export type { CapabilityPreparation } from "./generated/capability-preparation";

export type { ResourceRemovalResult } from "./generated/resource-removal-result";

export type { ResourceMigrationPreview, ResourceMigrationSource, ResourceMigrationCandidate } from "./generated/resource-migration-preview";

export type { ResourceAdoptionResult } from "./generated/resource-adoption-result";

export type { LocalResourceMovePlan } from "./generated/local-resource-move-plan";

export type { LocalResourceMoveResult } from "./generated/local-resource-move-result";

export type { UnusedResourceCleanupPlan } from "./generated/unused-resource-cleanup-plan";

export type { UnusedResourceCleanupResult } from "./generated/unused-resource-cleanup-result";

export type { ResourceVersionDiagnostic, ResourceDiagnosticItem, ResourceTaskDiagnostic, LocalResourceDiagnostics } from "./generated/local-resource-diagnostics";

export type { ResourceRollbackResult } from "./generated/resource-rollback-result";

export type { OldResourceVersionCandidate } from "./generated/old-resource-version-cleanup-plan";

export type { OldResourceVersionCleanupPlan } from "./generated/old-resource-version-cleanup-plan";

export type { OldResourceVersionCleanupResult } from "./generated/old-resource-version-cleanup-result";

export type { DeleteProjectResult } from "./generated/delete-project-result";

export type RemoteMediaKind = "direct_file" | "hls";

export type RemoteMediaPreview = {
  originalUrl: string;
  finalUrl: string;
  displayName: string;
  mediaKind: RemoteMediaKind;
  contentType: string | null;
  contentLength: number | null;
  previewToken: string;
};

export type YouTubeMediaPreview = {
  originalUrl: string;
  webpageUrl: string;
  videoId: string;
  title: string;
  durationSeconds: number;
  fileSizeBytes: number | null;
  importerVersion: string;
  importerSha256: string;
  previewToken: string;
};

export type DesktopCommandError = {
  code: string;
  message: string;
};

export type SubtitleFileFormat = "srt" | "vtt";

export type SubtitleCue = {
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
};

export type SubtitleImportPreview = {
  format: SubtitleFileFormat;
  sourceLabel: string;
  sourceSha256: string;
  languageCode: string;
  expectedProjectRevision: number;
  expectedMediaSha256: string;
  cues: SubtitleCue[];
  preflight: SubtitlePreflightReport;
  canImport: boolean;
};

export type EmbeddedSubtitlePreview = SubtitleImportPreview & {
  streamIndex: number;
  codecName: string;
  embeddedLanguage: string | null;
};

export type SubtitleSegmentEdit = {
  segmentId: string;
  text?: string;
  issueKind?: "none" | "missing" | "duplicate" | "incorrect";
};

export type SubtitleGlobalReplacement = {
  findText: string;
  replaceText: string;
};







export type { TranscriptionJob } from "./generated/transcription-job";

export type { TranslationTask, TranslationValidation } from "./generated/translation-task";
export type { TranslationApplication } from "./generated/translation-application";

export type { ExternalAgentTaskKind, ExternalAgentResultUpdate } from "./generated/external-agent-result-update";

export type { CodexRuntimeStatus } from "./generated/codex-runtime-status";
export type { AiTaskExecutionInfo } from "./generated/learning-task";

export type { StorageSettingsView as StorageSettings } from "./generated/storage-settings";
export type { SaveStorageSettingsInput } from "./generated/save-storage-settings-input";

export type LearningSelectionKind = "word" | "phrase" | "sentence";

export type { LearningTask } from "./generated/learning-task";
export type { DictionaryEntry } from "./generated/dictionary-entry";

export type { LearningApplication } from "./generated/learning-application";

export type LearningCard = {
  id: string;
  projectId: string;
  dictionaryEntryId: string | null;
  sourceVersionId: string;
  translationVersionId: string | null;
  sourceSegmentId: string;
  selectedText: string;
  selectionKind: LearningSelectionKind;
  pronunciation: string;
  partOfSpeech: string;
  contextualMeaning: string;
  usageNote: string | null;
  sourceSentence: string;
  translatedSentence: string | null;
  languageCode: string;
  playbackPositionMs: number;
  screenshotPath: string;
  screenshotSha256: string;
  screenshotAvailable: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

export type LearningCardsExport = {
  directory: string;
  jsonPath: string;
  markdownPath: string;
  cardCount: number;
};

export type SubtitleExportMode = "original" | "translation" | "bilingual";

export type SubtitleExportFormat = "srt" | "vtt";

export type SubtitleExport = {
  filePath: string;
  manifestPath: string;
  fileSha256: string;
  mode: SubtitleExportMode;
  format: SubtitleExportFormat;
  cueCount: number;
  sourceVersionId: string | null;
  translationVersionId: string | null;
  mediaSha256: string;
  exportedAtMs: number;
};

export type { SubtitleBurnMode, SubtitleBurnJob } from "./generated/subtitle-burn-job";

export type { SubtitleBurnStyle } from "./generated/subtitle-burn-input";

export type { ResourceDownloadSnapshot } from "./generated/resource-download-snapshot";

export type ResourceLocationResult = import("./generated/resource-location-result").ResourceLocationResult;

export type { MediaRuntimeStatus } from "./generated/media-runtime-status";
export type { TranscriptionRuntimeStatus, TranscriptionRuntimeOption, TranscriptionModelStatus } from "./generated/transcription-runtime-status";
