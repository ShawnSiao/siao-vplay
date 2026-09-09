/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type TranslationDispatchKind = "codex" | "manual" | "api";
export type TranslationDispatchScope = "full_subtitles" | "selected_subtitles";

export interface TranslationDispatchPreview {
  confirmationSha256: string;
  context: {
    [k: string]: unknown;
  };
  glossary: {
    [k: string]: unknown;
  };
  handoffKind: TranslationDispatchKind;
  model: string;
  receiver: string;
  scope: TranslationDispatchScope;
  segments: SegmentScope[];
  sourceLanguageCode: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  targetLanguageCode: string;
  taskId: string;
  [k: string]: unknown;
}
export interface SegmentScope {
  endMs: number;
  id: string;
  startMs: number;
  [k: string]: unknown;
}
