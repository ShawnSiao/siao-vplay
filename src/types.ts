export interface PromptSelection {
  templateId: string;
  oneTimeRequirements: string;
}

export type { ExplanationFrame, ExplanationTask, ExplanationMaterialSummary } from "./generated/explanation-task";
export type { Explanation, ExplanationEntry } from "./generated/explanation";
export type { ExplanationApplication } from "./generated/explanation-application";
export type { SubtitleIssueSeverity, SubtitleIssueCode, SubtitlePreflightIssue, SubtitlePreflightReport, SubtitleWord, SubtitleSegment, SubtitleVersion } from "./generated/subtitle-version";
import type {
  LibraryItemAvailability,
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

export type { LibraryScanPhase, LibraryScanProgress } from "./generated/library-scan-progress";

export type { LibraryScanPreview } from "./generated/library-scan-preview";

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

export type { LibraryImportResult } from "./generated/library-import-result";

export type LibraryRecoveryItem = {
  collectionId: string;
  projectId: string;
  relativePath: string;
  displayTitle: string;
  previousAvailability: LibraryItemAvailability;
};

export type { LibraryRescanPreview } from "./generated/library-rescan-preview";

export type ApplyLibraryRescanInput = {
  previewToken: string;
  newItems: ConfirmLibraryItemInput[];
  confirmMissing: boolean;
  confirmChanged: boolean;
  confirmFingerprintDuplicates: boolean;
};

export type { LibraryRescanResult } from "./generated/library-rescan-result";

export type RelocationMismatchReason =
  | "missing"
  | "fingerprint_changed"
  | "invalid_relative_path";

export type LibraryRelocationMismatch = {
  projectId: string;
  relativePath: string;
  reason: RelocationMismatchReason;
};

export type { LibraryRootRelocationPreview } from "./generated/library-relocation-preview";

export type { LibraryRootRelocationResult } from "./generated/library-relocation-result";

export type { LibraryCollectionDeletionResult } from "./generated/collection-deletion-result";

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

export type { LibraryRootRebuildPreview } from "./generated/library-rebuild-preview";

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

export type { LibraryRootRebuildResult } from "./generated/library-rebuild-result";

export type { LibraryRootRevokeResult } from "./generated/library-root-revoke-result";

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

export type { RemoteMediaKind, RemoteMediaPreview } from "./generated/remote-media-preview";

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

export type { SubtitleImportPreview } from "./generated/subtitle-import-preview";
export type { EmbeddedSubtitlePreview } from "./generated/embedded-subtitle-preview";

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

export type { LearningCard } from "./generated/learning-card";

export type { LearningCardsExport } from "./generated/learning-cards-export";





export type { SubtitleExport, SubtitleExportMode, SubtitleExportFormat } from "./generated/subtitle-export";

export type { SubtitleBurnMode, SubtitleBurnJob } from "./generated/subtitle-burn-job";

export type { SubtitleBurnStyle } from "./generated/subtitle-burn-input";

export type { ResourceDownloadSnapshot } from "./generated/resource-download-snapshot";

export type ResourceLocationResult = import("./generated/resource-location-result").ResourceLocationResult;

export type { MediaRuntimeStatus } from "./generated/media-runtime-status";
export type { TranscriptionRuntimeStatus, TranscriptionRuntimeOption, TranscriptionModelStatus } from "./generated/transcription-runtime-status";
