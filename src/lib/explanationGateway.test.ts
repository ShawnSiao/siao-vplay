import { beforeEach, expect, it, vi } from "vitest";
import { createUnderstandingFixtures } from "../test-fixtures/understanding";
import { getExplanationTask, getExplanation, listExplanations, importExplanationResult } from "./desktop";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { explanationTask: task, explanation } = createUnderstandingFixtures({ projectId: "p", sourceVersionId: "s", translationVersionId: "t", sourceSegmentId: "segment" });
beforeEach(() => { invoke.mockReset(); });
it.each([{ id: "wrong" }, { status: "unknown" }, { execution: null }, { progress: 2 }, { frames: null }])("rejects invalid task %j", async patch => {
  invoke.mockResolvedValue({ ...task, ...patch }); await expect(getExplanationTask(task.id)).rejects.toThrow();
});
it.each([{ id: "wrong" }, { confirmedFacts: null }, { materialSummary: null }])("rejects invalid explanation %j", async patch => {
  invoke.mockResolvedValue({ ...explanation, ...patch }); await expect(getExplanation(explanation.id)).rejects.toThrow();
});
it("rejects wrong-project and duplicate history", async () => {
  for (const value of [[explanation, explanation], [{ ...explanation, projectId: "other" }]]) {
    invoke.mockResolvedValue(value); await expect(listExplanations("p")).rejects.toThrow();
  }
});
it("rejects a completed import with the wrong task association", async () => {
  invoke.mockResolvedValue({ task: { ...task, status: "completed", outputExplanationId: explanation.id }, explanation: { ...explanation, taskId: "wrong" } });
  await expect(importExplanationResult(task.id, "fixture.json")).rejects.toThrow();
});

it("accepts the emitted task and completed application", async () => {
  invoke.mockResolvedValue(task); await expect(getExplanationTask(task.id)).resolves.toEqual(task);
  const application = { task: { ...task, status: "completed", outputExplanationId: explanation.id }, explanation };
  invoke.mockResolvedValue(application); await expect(importExplanationResult(task.id, "fixture.json")).resolves.toEqual(application);
});
