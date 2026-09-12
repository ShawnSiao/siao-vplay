import { beforeEach, expect, it } from "vitest";
import { discardLearningDraft, readLearningDraft, writeLearningDraft } from "./learningDraft";
import type { LearningContext } from "./learningContext";
const context = { projectId: "one", sourceVersion: { id: "original", segments: [{ text: "private full transcript" }] },
  sourceSegment: { id: "line" }, translationVersion: null, playbackPositionMs: 5000 } as LearningContext;
beforeEach(() => { sessionStorage.clear(); });
it("keeps invalid unfinished input and receiver across remounts without storing transcript or authorization", () => {
  writeLearningDraft(context, "unfinished input", null, { kind: "manual", serviceId: null, modelId: "" });
  expect(readLearningDraft("one")).toMatchObject({ selectedText: "unfinished input", sourceVersionId: "original", execution: { kind: "manual" } });
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toContain("private full transcript");
  expect(readLearningDraft("two")).toBeNull();
  discardLearningDraft("two");
  expect(readLearningDraft("one")).not.toBeNull();
  discardLearningDraft("one");
  expect(readLearningDraft("one")).toBeNull();
});
it("preserves an unknown schema instead of overwriting it during reading", () => {
  sessionStorage.setItem("siaovplay:learning-draft:v1:one", '{"schemaVersion":99}');
  expect(() => readLearningDraft("one")).toThrow("格式无法识别");
  expect(sessionStorage.getItem("siaovplay:learning-draft:v1:one")).toBe('{"schemaVersion":99}');
});
