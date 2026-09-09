/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type SubtitleExportFormat = "srt" | "vtt";
export type SubtitleExportMode = "original" | "translation" | "bilingual";

export interface SubtitleExport {
  cueCount: number;
  exportedAtMs: number;
  filePath: string;
  fileSha256: string;
  format: SubtitleExportFormat;
  manifestPath: string;
  mediaSha256: string;
  mode: SubtitleExportMode;
  sourceVersionId: string | null;
  translationVersionId: string | null;
  [k: string]: unknown;
}
