/* Generated from Rust IPC schema. Run npm run contracts:generate. */

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
export type SubtitleTrackRole = "original" | "translation";
export type SubtitleCorrection = "missing" | "duplicate" | "incorrect";
export type SubtitleSource = "imported_file" | "embedded" | "transcription" | "agent_translation";
export type SubtitleRevisionStatus = "draft" | "ready" | "rejected";

export interface SubtitleVersion {
  createdAtMs: number;
  id: string;
  isCurrent: boolean;
  languageCode: string;
  mediaSha256: string;
  parentVersionId: string | null;
  preflight: SubtitlePreflightReport;
  projectId: string;
  projectRevision: number;
  role: SubtitleTrackRole;
  segments: SubtitleSegment[];
  sourceKind: SubtitleSource;
  sourceLabel: string;
  sourceSha256: string;
  sourceTaskId: string | null;
  status: SubtitleRevisionStatus;
  trackId: string;
  versionNumber: number;
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
export interface SubtitleSegment {
  confidence: number | null;
  endMs: number;
  id: string;
  issueKind: SubtitleCorrection | null;
  lineageId: string;
  ordinal: number;
  sourceSegmentId: string | null;
  startMs: number;
  text: string;
  words: SubtitleWord[];
  [k: string]: unknown;
}
export interface SubtitleWord {
  confidence: number | null;
  endMs: number;
  ordinal: number;
  startMs: number;
  text: string;
  [k: string]: unknown;
}
