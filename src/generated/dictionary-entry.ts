/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type SelectionKind = "word" | "phrase" | "sentence";

export interface DictionaryEntry {
  contextualMeaning: string;
  createdAtMs: number;
  id: string;
  languageCode: string;
  partOfSpeech: string;
  playbackPositionMs: number;
  projectId: string;
  pronunciation: string;
  selectedText: string;
  selectionKind: SelectionKind;
  sourceSegmentId: string;
  sourceSentence: string;
  sourceVersionId: string;
  taskId: string;
  translatedSentence: string | null;
  translationVersionId: string | null;
  usageNote: string | null;
  [k: string]: unknown;
}
