import type { PromptSelection } from "../analysis/types";

export type SummaryScope = "current_progress" | "full_video";
export type SummaryAnalysisMode =
  | "automatic"
  | "general"
  | "science_technology"
  | "software_architecture";
export type SummaryExecutionKind = "manual" | "codex" | "api";

import type { SummaryTask } from "../../generated/summary-task";
export type { SummaryTask, SummaryChunk } from "../../generated/summary-task";
export type SummaryTaskStatus = SummaryTask["status"];

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
