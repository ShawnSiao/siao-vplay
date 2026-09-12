import validate from "../generated/dictionary-entry.validator.mjs";
import type { DictionaryEntry } from "../types";
export function parseDictionaryEntry(value: unknown, expected: { entryId?: string; projectId?: string } = {}): DictionaryEntry {
  if (!validate(value) || !value.id.trim() || !value.projectId.trim() || !value.taskId.trim() ||
    !value.sourceVersionId.trim() || !value.sourceSegmentId.trim() || !value.selectedText.trim() ||
    (value.translationVersionId !== null && !value.translationVersionId.trim()) ||
    (expected.entryId !== undefined && value.id !== expected.entryId) ||
    (expected.projectId !== undefined && value.projectId !== expected.projectId)) throw new Error("学习结果格式无效或与当前请求不匹配。");
  return value;
}
