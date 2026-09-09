import { expect, it } from "vitest";
import { dictionaryEntryFixture as entry } from "../../test-fixtures/dictionary";
import { requireLearningResult } from "./learningResult";
const task = { id: entry.taskId, projectId: entry.projectId, sourceVersionId: entry.sourceVersionId,
  translationVersionId: entry.translationVersionId, sourceSegmentId: entry.sourceSegmentId, selectedText: entry.selectedText,
  selectionKind: entry.selectionKind, playbackPositionMs: entry.playbackPositionMs, outputDictionaryEntryId: entry.id };
it.each(["id", "taskId", "projectId", "sourceVersionId", "translationVersionId", "sourceSegmentId", "selectedText", "selectionKind", "playbackPositionMs"])("rejects mismatched learning result %s", field => {
  expect(() => requireLearningResult({ ...entry, [field]: field === "playbackPositionMs" ? 200 : "other" }, task)).toThrow();
});
it("accepts matching completion and manually imported results before an output id was assigned", () => {
  expect(requireLearningResult(entry, task)).toEqual(entry);
  expect(requireLearningResult(entry, { ...task, outputDictionaryEntryId: null })).toEqual(entry);
});
