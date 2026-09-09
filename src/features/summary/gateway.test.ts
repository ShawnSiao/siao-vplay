import { beforeEach, expect, it, vi } from "vitest";
import { createSummaryFixtures } from "../../test-fixtures/summary";
import { getSummaryTask, listSummaryTasks, startSummaryTask, prepareSummaryTask, resumeSummaryTask, cancelSummaryTask } from "./gateway";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { task } = createSummaryFixtures();
beforeEach(() => { invoke.mockReset(); });
it.each([{ id: "wrong" }, { status: "unknown" }, { progress: 2 }, { chunks: null },
  { chunks: [task.chunks[0], task.chunks[0]] }])("rejects invalid summary task %j", async patch => {
  invoke.mockResolvedValue({ ...task, ...patch });
  await expect(getSummaryTask(task.id)).rejects.toThrow();
});
it("rejects wrong-project and duplicate history tasks", async () => {
  for (const value of [[{ ...task, projectId: "other" }], [task, task], null]) {
    invoke.mockResolvedValue(value);
    await expect(listSummaryTasks(task.projectId)).rejects.toThrow();
  }
});
it("retains start confirmation while checking returned identity", async () => {
  invoke.mockResolvedValue(task);
  await expect(startSummaryTask(task.id, "confirmed")).resolves.toEqual(task);
  expect(invoke).toHaveBeenCalledWith("start_summary_task", { input: { taskId: task.id, confirmationSha256: "confirmed" } });
});

it.each(["prepared", "awaiting_external_result", "queued", "running", "paused", "validating", "completed", "failed", "cancelled", "interrupted"])("accepts supported status %s", async status => {
  invoke.mockResolvedValue({ ...task, status });
  await expect(getSummaryTask(task.id)).resolves.toMatchObject({ status });
});
it.each([-1, 256, 1.5])("rejects invalid chunk retry count %s", async retryCount => {
  invoke.mockResolvedValue({ ...task, chunks: [{ ...task.chunks[0], retryCount }] });
  await expect(getSummaryTask(task.id)).rejects.toThrow();
});
it("validates prepare ownership and both resume/cancel identities", async () => {
  invoke.mockResolvedValue({ ...task, projectId: "other" });
  await expect(prepareSummaryTask({ projectId: task.projectId, scope: "current_progress", playbackCutoffMs: 0,
    analysisMode: "automatic", executionKind: "manual", promptSelection: { templateId: "builtin", oneTimeRequirements: "" },
    visualMaterialAuthorized: false, subtitlesAuthorized: true, spoilerConfirmed: false,
    serviceConfigId: null, serviceRevision: null, providerId: null, modelId: null })).rejects.toThrow();
  invoke.mockResolvedValue({ ...task, id: "other" });
  await expect(resumeSummaryTask(task.id, "confirmed")).rejects.toThrow();
  await expect(cancelSummaryTask(task.id)).rejects.toThrow();
});
