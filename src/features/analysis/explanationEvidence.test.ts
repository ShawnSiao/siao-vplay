import { beforeEach, expect, it, vi } from "vitest";
import { createUnderstandingFixtures } from "../../test-fixtures/understanding";
import { readExplanationEvidence, type ExplanationEvidence } from "./explanationEvidence";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { explanation } = createUnderstandingFixtures({ projectId: "project", sourceVersionId: "original", translationVersionId: "translation", sourceSegmentId: "line" });
const evidence: ExplanationEvidence = { explanationId: explanation.id, taskId: explanation.taskId, projectId: explanation.projectId, sourceVersionId: "original", playbackCutoffMs: 42000,
  subtitles: [{ segmentId: "line", startMs: 2000, endMs: 3000, text: "原任务原文" }], frames: [{ id: explanation.possibleInterpretations[0].frameIds[0], timestampMs: 41750 }] };
beforeEach(() => invoke.mockReset());
it("accepts only the exact result and authorized references", async () => {
  invoke.mockResolvedValue(evidence);
  expect(await readExplanationEvidence(explanation)).toEqual(evidence);
  expect(invoke).toHaveBeenCalledWith("get_explanation_evidence", { explanationId: explanation.id });
});
it.each([
  { projectId: "other" }, { taskId: "other" }, { sourceVersionId: "revised" }, { playbackCutoffMs: 42001 },
  { subtitles: [] }, { subtitles: [...evidence.subtitles, ...evidence.subtitles] },
  { subtitles: [{ ...evidence.subtitles[0], segmentId: "unreferenced" }] },
  { subtitles: [{ ...evidence.subtitles[0], startMs: 43000 }] },
  { frames: [{ ...evidence.frames[0], timestampMs: 43000 }] },
  { frames: [null] },
])("rejects mismatched or out-of-range evidence", async (change) => {
  invoke.mockResolvedValue({ ...evidence, ...change });
  await expect(readExplanationEvidence(explanation)).rejects.toThrow();
});

it.each(["原".repeat(20_000), "😀".repeat(20_000)])("accepts the backend Unicode character limit", async text => {
  const value = { ...evidence, subtitles: [{ ...evidence.subtitles[0], text }] };
  invoke.mockResolvedValue(value);
  await expect(readExplanationEvidence(explanation)).resolves.toEqual(value);
});
it("rejects more than the backend Unicode character limit", async () => {
  invoke.mockResolvedValue({...evidence, subtitles:[{...evidence.subtitles[0], text:"😀".repeat(20_001)}]});
  await expect(readExplanationEvidence(explanation)).rejects.toThrow();
});
