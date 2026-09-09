import type { DictionaryEntry } from "../../types";
import type { LearningContext } from "./learningContext";
export function findLearningHistory(entries: DictionaryEntry[], context: LearningContext, selectedText: string): DictionaryEntry | null {
  if (!context.sourceVersion || !context.sourceSegment) return null;
  return entries.find(entry => entry.projectId === context.projectId &&
    entry.sourceVersionId === context.sourceVersion?.id &&
    entry.translationVersionId === (context.translationVersion?.id ?? null) &&
    entry.sourceSegmentId === context.sourceSegment?.id && entry.selectedText === selectedText) ?? null;
}
