export type AppStatus = {
  appName: string;
  version: string;
  platform: string;
  dataDirectory: string;
  startupMediaPath: string | null;
};

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
  volume: number;
  playbackRate: number;
  updatedAtMs: number;
};

export type Project = {
  id: string;
  title: string;
  status: ProjectStatus;
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
  lastOpenedAtMs: number;
  mediaSource: MediaSource;
  playbackState: PlaybackState;
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

export type MediaPreparation = {
  inspection: MediaInspection;
  playbackSourceKind: "original" | "proxy";
  playbackPath: string;
  proxyArtifact: MediaArtifact | null;
  reusedProxy: boolean;
};

export type MediaRuntimeStatus = {
  available: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  version: string | null;
  errorMessage: string | null;
};

export type DeleteProjectResult = {
  projectId: string;
  deleted: boolean;
  sourceMediaDeleted: false;
  cachedMediaDeleted: boolean;
};

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

export type SubtitleIssueSeverity = "error" | "warning";

export type SubtitleIssueCode =
  | "empty_text"
  | "invalid_timing"
  | "out_of_order"
  | "out_of_bounds"
  | "overlap"
  | "long_gap"
  | "duration_too_short"
  | "duration_too_long"
  | "reading_speed_high";

export type SubtitlePreflightIssue = {
  code: SubtitleIssueCode;
  severity: SubtitleIssueSeverity;
  ordinal: number | null;
  relatedOrdinal: number | null;
  message: string;
};

export type SubtitlePreflightReport = {
  status: "ready" | "warning" | "blocked";
  segmentCount: number;
  errorCount: number;
  warningCount: number;
  firstStartMs: number | null;
  lastEndMs: number | null;
  mediaDurationMs: number | null;
  coverageRatio: number | null;
  issues: SubtitlePreflightIssue[];
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

export type SubtitleWord = {
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
};

export type SubtitleSegment = SubtitleCue & {
  id: string;
  sourceSegmentId: string | null;
  words: SubtitleWord[];
};

export type SubtitleVersion = {
  id: string;
  trackId: string;
  projectId: string;
  role: "original" | "translation";
  versionNumber: number;
  status: "draft" | "ready" | "rejected";
  sourceKind:
    | "imported_file"
    | "embedded"
    | "transcription"
    | "agent_translation";
  sourceLabel: string;
  sourceSha256: string;
  mediaSha256: string;
  languageCode: string;
  projectRevision: number;
  parentVersionId: string | null;
  sourceTaskId: string | null;
  preflight: SubtitlePreflightReport;
  createdAtMs: number;
  isCurrent: boolean;
  segments: SubtitleSegment[];
};

export type TranscriptionRuntimeOption = {
  backend: "vulkan" | "cpu";
  available: boolean;
  version: string | null;
  errorMessage: string | null;
};

export type TranscriptionModelStatus = {
  modelKind: "small" | "base";
  available: boolean;
  errorMessage: string | null;
};

export type TranscriptionRuntimeStatus = {
  available: boolean;
  preferredBackend: "vulkan" | "cpu" | null;
  runtimes: TranscriptionRuntimeOption[];
  models: TranscriptionModelStatus[];
};

export type TranscriptionJob = {
  id: string;
  projectId: string;
  status:
    | "queued"
    | "extracting"
    | "transcribing"
    | "validating"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  stage: string;
  progress: number;
  languageCode: "en" | "th" | "ja" | "ko";
  modelKind: "small" | "base";
  runtimeBackend: "vulkan" | "cpu";
  runtimeVersion: string;
  subtitleVersionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs: number | null;
  completedAtMs: number | null;
};

export type TranslationTask = {
  id: string;
  projectId: string;
  taskType: "subtitle_translation";
  handoffKind: "manual" | "codex";
  protocolVersion: string;
  status:
    | "awaiting_external_result"
    | "queued"
    | "running"
    | "validating"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  stage: string;
  progress: number;
  receiverLabel: string;
  materialScope: string[];
  sourceVersionId: string;
  sourceLanguageCode: string;
  targetLanguageCode: "zh-cn";
  segmentCount: number;
  expectedProjectRevision: number;
  outputVersionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs: number | null;
  completedAtMs: number | null;
};

export type TranslationValidation = {
  status: "accepted" | "accepted_with_warnings";
  translationCount: number;
  warningCount: number;
  warnings: string[];
};

export type TranslationApplication = {
  task: TranslationTask;
  subtitleVersion: SubtitleVersion;
  validation: TranslationValidation;
};

export type CodexRuntimeStatus = {
  available: boolean;
  authenticated: boolean;
  supported: boolean;
  version: string | null;
  authMode: "chatgpt" | "api_key" | null;
  minimumVersion: string;
  errorCode: string | null;
  errorMessage: string | null;
};
