import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUnderstandingFixtures } from "../../test-fixtures/understanding";
import { taskDispatchFixture } from "../../test-fixtures/taskDispatch";
import { executeExplanationDispatch, previewTaskDispatch } from "./taskDispatch";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), start: vi.fn(), resume: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/desktop", () => ({ startCodexExplanationTask: mocks.start, resumeCodexExplanationTask: mocks.resume,
  startCodexLearningTask: mocks.start, resumeCodexLearningTask: mocks.resume }));
const { explanationTask: task } = createUnderstandingFixtures({ projectId: "project", sourceVersionId: "source", translationVersionId: "translation", sourceSegmentId: "segment" });

beforeEach(() => vi.resetAllMocks());

describe("confirmed AI dispatch", () => {
  it("previews without starting execution and preserves the confirmed hash at the IPC boundary", async () => {
    mocks.invoke.mockResolvedValue(taskDispatchFixture(task));
    const preview = await previewTaskDispatch("explanation", task.id);
    expect(mocks.start).not.toHaveBeenCalled();
    await executeExplanationDispatch(task, preview);
    expect(mocks.start).toHaveBeenCalledWith(task.id, undefined, preview.confirmationSha256);
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it("uses the same confirmed service, revision and material permissions for initial API execution", async () => {
    const preview = taskDispatchFixture(task);
    preview.execution = { kind: "api", serviceConfigId: "service", modelId: "model" };
    preview.authorization.serviceRevision = 3;
    await executeExplanationDispatch(task, preview);
    expect(mocks.invoke).toHaveBeenCalledWith("resume_explanation_task", { input: {
      taskId: task.id, execution: preview.execution, authorization: preview.authorization, confirmationSha256: preview.confirmationSha256,
    } });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each(["wrong-task", "future-frame", "missing-hash", "mismatched-frame-permission"])("rejects an invalid preview: %s", async (scenario) => {
    const preview = taskDispatchFixture(task);
    if (scenario === "wrong-task") preview.taskId = "another-task";
    if (scenario === "future-frame") preview.frames[0].timestampMs = preview.playbackCutoffMs + 1;
    if (scenario === "missing-hash") preview.confirmationSha256 = "";
    if (scenario === "mismatched-frame-permission") preview.authorization.frames = false;
    mocks.invoke.mockResolvedValue(preview);
    await expect(previewTaskDispatch("explanation", task.id)).rejects.toThrow("发送清单无效");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("cannot apply one task's confirmation to another task", async () => {
    await expect(executeExplanationDispatch({ ...task, id: "different" }, taskDispatchFixture(task))).rejects.toThrow("任务已改变");
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
