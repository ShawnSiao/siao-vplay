import { prepareAiLearningTask, resumeLearningTask } from "../features/ai-tasks/gateway";
import { beforeEach, expect, it, vi } from "vitest";
import { createLearningTaskFixture } from "../test-fixtures/learning";
import { dictionaryEntryFixture } from "../test-fixtures/dictionary";
import { getLearningTask, listLearningTasks, importLearningResult, startCodexLearningTask, resumeCodexLearningTask, cancelLearningTask } from "./desktop";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const task = createLearningTaskFixture();
beforeEach(() => { invoke.mockReset(); });
it.each([{ id: "wrong" }, { status: "unknown" }, { progress: 2 }, { execution: null }, { selectionKind: "unknown" }])("rejects invalid learning tasks %j", async patch => {
  invoke.mockResolvedValue({ ...task, ...patch });
  await expect(getLearningTask(task.id)).rejects.toThrow();
});
it("rejects wrong-project and duplicate task lists", async () => {
  for (const value of [[{ ...task, projectId: "other" }], [task, task]]) {
    invoke.mockResolvedValue(value); await expect(listLearningTasks(task.projectId)).rejects.toThrow();
  }
});
it("rejects an imported result unrelated to its completed task", async () => {
  invoke.mockResolvedValue({ task: { ...task, status: "completed", outputDictionaryEntryId: dictionaryEntryFixture.id }, dictionaryEntry: dictionaryEntryFixture });
  await expect(importLearningResult(task.id, "fixture.json")).rejects.toThrow();
});

it.each(["awaiting_external_result", "queued", "running", "validating", "completed", "failed", "cancelled", "interrupted"])("accepts known status %s", async status => {
  invoke.mockResolvedValue({ ...task, status }); await expect(getLearningTask(task.id)).resolves.toMatchObject({ status });
});
it("accepts a complete matching imported result", async () => {
  const application = { task: { ...task, status: "completed", outputDictionaryEntryId: dictionaryEntryFixture.id },
    dictionaryEntry: { ...dictionaryEntryFixture, taskId: task.id } };
  invoke.mockResolvedValue(application);
  await expect(importLearningResult(task.id, "fixture.json")).resolves.toEqual(application);
});
it.each([{ protocolVersion: "unknown" }, { execution: { ...task.execution, kind: "api" } }, { sourceVersionId: " " }])("rejects invalid task context %j", async patch => {
  invoke.mockResolvedValue({ ...task, ...patch }); await expect(getLearningTask(task.id)).rejects.toThrow();
});

it("retains confirmations and rejects unrelated mutation responses", async () => {
  invoke.mockResolvedValue(task);
  await startCodexLearningTask(task.id, 90, "confirmed");
  expect(invoke).toHaveBeenLastCalledWith("start_codex_learning_task", { input: { taskId: task.id, timeoutSeconds: 90 }, confirmationSha256: "confirmed" });
  invoke.mockResolvedValue({ ...task, id: "other" });
  await expect(startCodexLearningTask(task.id, 90, "confirmed")).rejects.toThrow();
  await expect(resumeCodexLearningTask(task.id, 90, "confirmed")).rejects.toThrow();
  await expect(cancelLearningTask(task.id)).rejects.toThrow();
});
it("rejects an API response that silently changes the execution kind", async () => {
  invoke.mockResolvedValue(task);
  const execution = { kind: "api", serviceConfigId: "service", modelId: "model" } as const;
  const authorization = { subtitles: true, currentQuestion: true, frames: false, serviceRevision: 7 };
  await expect(prepareAiLearningTask({ projectId: task.projectId, sourceSegmentId: task.sourceSegmentId,
    selectedText: task.selectedText, selectionKind: task.selectionKind, playbackPositionMs: task.playbackPositionMs,
    execution, authorization })).rejects.toThrow();
  await expect(resumeLearningTask(task.id, execution, authorization, "confirmed")).rejects.toThrow();
});
