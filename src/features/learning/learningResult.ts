import { parseDictionaryEntry } from "../../lib/dictionaryContract";
import type { DictionaryEntry, LearningTask } from "../../types";
type Context = Pick<LearningTask, "id" | "projectId" | "sourceVersionId" | "translationVersionId" | "sourceSegmentId" |
  "selectedText" | "selectionKind" | "playbackPositionMs" | "outputDictionaryEntryId">;
export function requireLearningResult(value: unknown, task: Context): DictionaryEntry {
  const entry = parseDictionaryEntry(value, { projectId: task.projectId });
  if (entry.taskId !== task.id || (task.outputDictionaryEntryId !== null && entry.id !== task.outputDictionaryEntryId) ||
    entry.sourceVersionId !== task.sourceVersionId || entry.translationVersionId !== task.translationVersionId ||
    entry.sourceSegmentId !== task.sourceSegmentId || entry.selectedText !== task.selectedText ||
    entry.selectionKind !== task.selectionKind || entry.playbackPositionMs !== task.playbackPositionMs) {
    throw new Error("学习结果与当前任务或字幕上下文不匹配。");
  }
  return entry;
}
