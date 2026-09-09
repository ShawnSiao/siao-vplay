/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type SubtitleBurnMode = "translation" | "bilingual";
export type SubtitleBurnTextSize = "small" | "medium" | "large";

export interface StartSubtitleBurnInput {
  confirmVersionSelection: boolean;
  destinationDirectory: string;
  mode: SubtitleBurnMode;
  projectId: string;
  sourceVersionId: string | null;
  style: SubtitleBurnStyle;
  translationVersionId: string;
  [k: string]: unknown;
}
export interface SubtitleBurnStyle {
  positionY: number;
  textSize: SubtitleBurnTextSize;
  [k: string]: unknown;
}
