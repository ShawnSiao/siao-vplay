/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type AnalysisMode = "automatic" | "general" | "science_technology" | "software_architecture";
export type ProtocolVersion = "siaovplay-summary-v1";
export type Timestamp = number;
export type EvidenceKind = "video_statement" | "subtitle_or_frame" | "ai_inference" | "needs_external_validation";
export type Ordinal = number;
export type AnalysisScope = "current_progress" | "full_video";

export interface VideoSummary {
  analysisMode: AnalysisMode;
  createdAtMs: number;
  id: string;
  materialManifestSha256: string;
  playbackCutoffMs: number | null;
  projectId: string;
  protocolVersion: ProtocolVersion;
  result: SummaryResult;
  scope: AnalysisScope;
  subtitleVersionId: string;
  taskId: string;
  updatedAtMs: number;
  visualMaterialUsed: boolean;
  [k: string]: unknown;
}
export interface SummaryResult {
  conclusions: SummarySection[];
  coreConcepts: SummarySection[];
  coveredChunkOrdinals: Ordinal[];
  designTradeoffs: SummarySection[];
  examplesAndScenarios: SummarySection[];
  formatVersion: number;
  glossary: SummaryGlossaryEntry[];
  limitations: string[];
  mermaid: string | null;
  overview: string;
  principlesOrArchitecture: SummarySection[];
  speakerNarrative: SummarySection[];
  timeline: SummarySection[];
  title: string;
  [k: string]: unknown;
}
export interface SummarySection {
  body: string;
  evidence: SummaryEvidence[];
  title: string;
  [k: string]: unknown;
}
export interface SummaryEvidence {
  citations?: SummaryCitation[];
  claim: string;
  frameTimestampsMs: Timestamp[];
  kind: EvidenceKind;
  subtitleIds: string[];
  [k: string]: unknown;
}
export interface SummaryCitation {
  endMs: number;
  excerpt: string;
  startMs: number;
  subtitleCount: number;
  [k: string]: unknown;
}
export interface SummaryGlossaryEntry {
  citations?: SummaryCitation[];
  explanation: string;
  subtitleIds: string[];
  term: string;
  [k: string]: unknown;
}
