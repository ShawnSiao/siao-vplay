/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type SummaryExecutionKind = "manual" | "codex" | "api";
export type AnalysisScope = "current_progress" | "full_video";

export interface SummaryDispatchPreview {
  confirmationSha256: string;
  endpoint: string | null;
  executionKind: SummaryExecutionKind;
  firstStartMs: number | null;
  frames: SummaryFrame[];
  lastEndMs: number | null;
  model: string;
  oneTimeRequirements: string;
  playbackCutoffMs: number | null;
  promptTemplate: string;
  receiver: string;
  scope: AnalysisScope;
  segmentCount: number;
  subtitleLanguage: string;
  subtitleRole: string;
  subtitleVersionId: string;
  subtitleVersionNumber: number;
  taskId: string;
  [k: string]: unknown;
}
export interface SummaryFrame {
  id: string;
  ordinal: number;
  relativePath: string;
  sha256: string;
  timestampMs: number;
  [k: string]: unknown;
}
