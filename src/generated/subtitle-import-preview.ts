/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type SubtitleFileFormat = "srt" | "vtt";
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
export type SubtitleIssueSeverity = "error" | "warning";
export type SubtitlePreflightStatus = "ready" | "warning" | "blocked";

export interface SubtitleImportPreview {
  canImport: boolean;
  cues: SubtitleCue[];
  expectedMediaSha256: string;
  expectedProjectRevision: number;
  format: SubtitleFileFormat;
  languageCode: string;
  preflight: SubtitlePreflightReport;
  sourceLabel: string;
  sourceSha256: string;
  [k: string]: unknown;
}
export interface SubtitleCue {
  confidence: number | null;
  endMs: number;
  ordinal: number;
  startMs: number;
  text: string;
  [k: string]: unknown;
}
export interface SubtitlePreflightReport {
  coverageRatio: number | null;
  errorCount: number;
  firstStartMs: number | null;
  issues: SubtitlePreflightIssue[];
  lastEndMs: number | null;
  mediaDurationMs: number | null;
  segmentCount: number;
  status: SubtitlePreflightStatus;
  warningCount: number;
  [k: string]: unknown;
}
export interface SubtitlePreflightIssue {
  code: SubtitleIssueCode;
  message: string;
  ordinal: number | null;
  relatedOrdinal: number | null;
  severity: SubtitleIssueSeverity;
  [k: string]: unknown;
}
