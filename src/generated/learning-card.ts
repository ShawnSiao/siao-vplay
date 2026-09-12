/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type SelectionKind = "word" | "phrase" | "sentence";

export interface LearningCard {
  contextualMeaning: string;
  createdAtMs: number;
  dictionaryEntryId: string | null;
  id: string;
  languageCode: string;
  partOfSpeech: string;
  playbackPositionMs: number;
  projectId: string;
  pronunciation: string;
  screenshotAvailable: boolean;
  screenshotPath: string;
  screenshotSha256: string;
  selectedText: string;
  selectionKind: SelectionKind;
  sourceSegmentId: string;
  sourceSentence: string;
  sourceVersionId: string;
  translatedSentence: string | null;
  translationVersionId: string | null;
  updatedAtMs: number;
  usageNote: string | null;
  [k: string]: unknown;
}
