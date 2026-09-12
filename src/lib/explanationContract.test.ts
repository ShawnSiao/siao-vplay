import { expect, it } from "vitest";
import { createUnderstandingFixtures } from "../test-fixtures/understanding";
import { requireExplanationResult, parseExplanationTask } from "./explanationContract";
const { explanationTask: task, explanation } = createUnderstandingFixtures({ projectId: "p", sourceVersionId: "s", translationVersionId: "t", sourceSegmentId: "segment" });
it.each([
  { taskId: "other" }, { projectId: "other" }, { sourceVersionId: "other" }, { translationVersionId: null },
  { playbackCutoffMs: 100 }, { sceneStartMs: 1 }, { protocolVersion: "siaovplay-understanding-v1" },
  { materialSummary: { ...task.materialSummary, subtitleCount: 2 } },
  { confirmedFacts: [{ text: "fact", subtitleSegmentIds: ["unapproved"], frameIds: [] }] },
  { possibleInterpretations: [{ text: "guess", subtitleSegmentIds: [], frameIds: ["unapproved"] }] },
])("rejects mismatched result context %j", patch => {
  expect(() => requireExplanationResult({ ...explanation, ...patch }, task)).toThrow();
});
it("rejects a different output identity", () => {
  expect(() => requireExplanationResult(explanation, { ...task, outputExplanationId: "different" })).toThrow();
});
it("accepts matching legacy text-only results", () => {
  const legacy = { ...explanation, protocolVersion: "siaovplay-understanding-v1", confirmedFacts: [{ text: "fact", subtitleSegmentIds: [], frameIds: [] }], possibleInterpretations: [] };
  expect(requireExplanationResult(legacy, { ...task, protocolVersion: legacy.protocolVersion })).toEqual(legacy);
});
it.each([
  { frames: [{ ...task.frames[0], timestampMs: task.playbackCutoffMs + 1 }] },
  { authorizedSegmentIds: ["segment", "segment"] },
  { execution: { ...task.execution, kind: "api" } },
])("rejects inconsistent task materials or execution %j", patch => {
  expect(() => parseExplanationTask({ ...task, ...patch })).toThrow();
});
