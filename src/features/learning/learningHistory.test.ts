import { expect, it } from "vitest";
import type { LearningContext } from "./learningContext";
import { dictionaryEntryFixture as entry } from "../../test-fixtures/dictionary";
import { createPlayerSubtitleFixtures } from "../../e2e/playerSubtitleFixtures";
import { findLearningHistory } from "./learningHistory";
const { originalSubtitle } = createPlayerSubtitleFixtures(entry.projectId);
const context: LearningContext = { projectId: entry.projectId, playbackPositionMs: 100,
  sourceVersion: { ...originalSubtitle, id: entry.sourceVersionId }, translationVersion: null,
  sourceSegment: { ...originalSubtitle.segments[0], id: entry.sourceSegmentId, text: entry.sourceSentence }, translationSegment: null };
it.each([{ projectId: "other" }, { sourceVersionId: "older" }, { translationVersionId: "older-translation" }])("does not reuse history from a different context %j", patch => {
  expect(findLearningHistory([{ ...entry, ...patch }], context, entry.selectedText)).toBeNull();
});
it("chooses the matching revision even if stale history appears first", () => {
  expect(findLearningHistory([{ ...entry, sourceVersionId: "older" }, entry], context, entry.selectedText)).toBe(entry);
});
it("keeps a matching result and requires the exact selection", () => {
  expect(findLearningHistory([entry], context, entry.selectedText)).toBe(entry);
  expect(findLearningHistory([entry], context, "different")).toBeNull();
});
