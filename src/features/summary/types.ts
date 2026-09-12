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

export type { EvidenceKind, SummaryEvidence, SummaryCitation, SummarySection, SummaryResult, VideoSummary } from "../../generated/video-summary";

export type { SummaryExport } from "../../generated/summary-export";

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
