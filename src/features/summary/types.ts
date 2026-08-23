import type { PromptSelection, PromptSnapshot } from "../analysis/types";

export type SummaryScope = "current_progress" | "full_video";
export type SummaryAnalysisMode =
  | "automatic"
  | "general"
  | "science_technology"
  | "software_architecture";
export type SummaryExecutionKind = "manual" | "codex" | "api";

export type SummaryChunk = {
  id: string;
  ordinal: number;
  startMs: number;
  endMs: number;
  segmentIds: string[];
  contextSegmentIds: string[];
  status: "prepared" | "queued" | "running" | "completed" | "failed" | "cancelled";
  retryCount: number;
};

export type SummaryTaskStatus =
  | "prepared"
  | "awaiting_external_result"
  | "queued"
  | "running"
  | "paused"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type SummaryTask = {
  id: string;
  projectId: string;
  scope: SummaryScope;
  playbackCutoffMs: number | null;
  analysisMode: SummaryAnalysisMode;
  executionKind: SummaryExecutionKind;
  promptSnapshot: PromptSnapshot;
  subtitleVersionId: string;
  materialManifestSha256: string;
  visualMaterialAuthorized: boolean;
  spoilerConfirmed: boolean;
  status: SummaryTaskStatus;
  stage: string;
  progress: number;
  serviceConfigId: string | null;
  serviceRevision: number | null;
  providerId: string | null;
  modelId: string | null;
  outputSummaryId: string | null;
  cancelRequested: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  chunks: SummaryChunk[];
  materialsDirectory: string;
};

export type EvidenceKind =
  | "video_statement"
  | "subtitle_or_frame"
  | "ai_inference"
  | "needs_external_validation";

export type SummaryEvidence = {
  kind: EvidenceKind;
  claim: string;
  subtitleIds: string[];
  frameTimestampsMs: number[];
  citations?: SummaryCitation[];
};

export type SummaryCitation = {
  startMs: number;
  endMs: number;
  subtitleCount: number;
  excerpt: string;
};

export type SummarySection = {
  title: string;
  body: string;
  evidence: SummaryEvidence[];
};

export type SummaryResult = {
  formatVersion: number;
  title: string;
  overview: string;
  coveredChunkOrdinals: number[];
  speakerNarrative: SummarySection[];
  timeline: SummarySection[];
  coreConcepts: SummarySection[];
  principlesOrArchitecture: SummarySection[];
  examplesAndScenarios: SummarySection[];
  designTradeoffs: SummarySection[];
  conclusions: SummarySection[];
  limitations: string[];
  glossary: Array<{ term: string; explanation: string; subtitleIds: string[]; citations?: SummaryCitation[] }>;
  mermaid: string | null;
};

export type VideoSummary = {
  id: string;
  taskId: string;
  projectId: string;
  protocolVersion: "siaovplay-summary-v1";
  scope: SummaryScope;
  playbackCutoffMs: number | null;
  analysisMode: SummaryAnalysisMode;
  subtitleVersionId: string;
  materialManifestSha256: string;
  result: SummaryResult;
  visualMaterialUsed: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

export type SummaryExport = {
  directory: string;
  reportPath: string;
  manifestPath: string;
  assetCount: number;
  reportSha256: string;
};

export type PrepareSummaryTaskInput = {
  projectId: string;
  scope: SummaryScope;
  playbackCutoffMs: number | null;
  analysisMode: SummaryAnalysisMode;
  executionKind: SummaryExecutionKind;
  promptSelection: PromptSelection;
  visualMaterialAuthorized: boolean;
  subtitlesAuthorized: boolean;
  spoilerConfirmed: boolean;
  serviceConfigId: string | null;
  serviceRevision: number | null;
  providerId: string | null;
  modelId: string | null;
};
