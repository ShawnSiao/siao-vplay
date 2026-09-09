import taskSchema from "../../contracts/translation-task.schema.json";
import applicationSchema from "../../contracts/translation-application.schema.json";
import { prepareApiTranslation, startApiTranslation } from "../features/ai-tasks/apiTranslation";
import { beforeEach, expect, it, vi } from "vitest";
import bodySchema from "../../contracts/subtitle-version.schema.json";
import { createTranslationTask } from "../test-fixtures/translation";
import { importTranslationResult, getTranslationTask, listTranslationTasks, prepareTranslationTask, startCodexTranslationTask, resumeCodexTranslationTask, cancelTranslationTask } from "./translationGateway";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const validation = { status: "accepted", translationCount: 1, warningCount: 0, warnings: [] };
const task = { ...createTranslationTask("p", { id: "original", segments: [{ id: "segment" }] }), status: "completed", outputVersionId: "v", validation };
const subtitleVersion = { ...bodySchema.examples[0], role: "translation", sourceKind: "agent_translation", sourceTaskId: task.id, languageCode: task.targetLanguageCode, segments: bodySchema.examples[0].segments.map(segment => ({ ...segment, sourceSegmentId: "segment" })) };
const application = { task, subtitleVersion, validation };
beforeEach(() => { invoke.mockReset(); });
it.each([
  { task: { ...task, id: "other-task" } }, { task: { ...task, status: "queued" } },
  { task: { ...task, outputVersionId: "other-version" } }, { task: { ...task, projectId: "other-project" } },
  { subtitleVersion: { ...subtitleVersion, role: "original" } },
  { subtitleVersion: { ...subtitleVersion, sourceTaskId: "other-task" } },
  { subtitleVersion: { ...subtitleVersion, segments: null } },
  { validation: { ...validation, warningCount: 2 } },
])("rejects malformed or unrelated imported translation envelopes %j", async patch => {
  invoke.mockResolvedValue({ ...application, ...patch });
  await expect(importTranslationResult(task.id, "fixture.json")).rejects.toThrow();
});
it.each([{ status: "unknown" }, { progress: 2 }, { handoffKind: "unknown" }, { id: "other" }, { segmentCount: 2 }, { baseTranslationVersionId: " " }, { outputVersionId: "" }])("rejects invalid task payload %j", async patch => {
  invoke.mockResolvedValue({ ...task, ...patch });
  await expect(getTranslationTask(task.id)).rejects.toThrow();
});
it("rejects unrelated and duplicate task lists", async () => {
  for (const value of [null, [task, task], [{ ...task, projectId: "other" }]]) {
    invoke.mockResolvedValue(value);
    await expect(listTranslationTasks("p")).rejects.toThrow();
  }
});
it("accepts matching completion without changing the import request", async () => {
  invoke.mockResolvedValue(application);
  await expect(importTranslationResult(task.id, "fixture.json")).resolves.toEqual(application);
  expect(invoke).toHaveBeenLastCalledWith("import_translation_result", { input: { taskId: task.id, resultPath: "fixture.json" } });
});

it.each(taskSchema.examples)("accepts Rust serialized translation task %#", async wire => {
  invoke.mockResolvedValue(wire);
  await expect(getTranslationTask(wire.id)).resolves.toEqual(wire);
});
it("accepts the Rust application wire sample", async () => {
  const wire = applicationSchema.examples[0];
  invoke.mockResolvedValue(wire);
  await expect(importTranslationResult(wire.task.id, "fixture.json")).resolves.toEqual(wire);
});
it("keeps existing merged translations while requiring coverage of the selected source segments", async () => {
  const merged = { ...subtitleVersion, segments: [...subtitleVersion.segments,
    { ...subtitleVersion.segments[0], id: "previous-translation", sourceSegmentId: "previous-source" }] };
  invoke.mockResolvedValue({ ...application, task: { ...task, baseTranslationVersionId: "previous" }, subtitleVersion: merged });
  await expect(importTranslationResult(task.id, "fixture.json")).resolves.toBeDefined();
  invoke.mockResolvedValue({ ...application, subtitleVersion: { ...subtitleVersion, segments: [] } });
  await expect(importTranslationResult(task.id, "fixture.json")).rejects.toThrow();
});
it("preserves dispatch confirmations while rejecting unrelated mutation results", async () => {
  invoke.mockResolvedValue(task);
  await prepareTranslationTask("p", "codex", "ja", "zh-cn", ["segment"]);
  expect(invoke).toHaveBeenLastCalledWith("prepare_translation_task", { input: { projectId: "p", handoffKind: "codex", sourceLanguageCode: "ja", targetLanguageCode: "zh-cn", segmentIds: ["segment"] } });
  await startCodexTranslationTask(task.id, 90, "confirmed");
  expect(invoke).toHaveBeenLastCalledWith("start_codex_translation_task", { input: { taskId: task.id, timeoutSeconds: 90 }, confirmationSha256: "confirmed" });
  await resumeCodexTranslationTask(task.id, 90, "confirmed");
  expect(invoke).toHaveBeenLastCalledWith("resume_codex_translation_task", { input: { taskId: task.id, timeoutSeconds: 90 }, confirmationSha256: "confirmed" });
  invoke.mockResolvedValue({ ...task, id: "other" });
  await expect(startCodexTranslationTask(task.id, 90, "confirmed")).rejects.toThrow();
  await expect(resumeCodexTranslationTask(task.id, 90, "confirmed")).rejects.toThrow();
  await expect(cancelTranslationTask(task.id)).rejects.toThrow();
});
it("validates API prepare/start results and retains service revision and confirmation", async () => {
  const execution = { kind: "api", serviceConfigId: "service", modelId: "model" } as const;
  invoke.mockResolvedValue({ ...task, handoffKind: "api" });
  await prepareApiTranslation("p", "ja", "zh-cn", ["segment"], execution, 7);
  expect(invoke).toHaveBeenLastCalledWith("prepare_api_translation", { input: { projectId: "p", sourceLanguageCode: "ja", targetLanguageCode: "zh-cn", segmentIds: ["segment"], execution, serviceRevision: 7 } });
  await startApiTranslation(task.id, "confirmed");
  expect(invoke).toHaveBeenLastCalledWith("start_api_translation", { input: { taskId: task.id, confirmationSha256: "confirmed" } });
  invoke.mockResolvedValue(task);
  await expect(prepareApiTranslation("p", "ja", "zh-cn", undefined, execution, 7)).rejects.toThrow();
  await expect(startApiTranslation(task.id, "confirmed")).rejects.toThrow();
});

it("rejects unselected additions to a fresh translation and duplicate source mappings", async () => {
  for (const extra of [{ ...subtitleVersion.segments[0], id: "extra", sourceSegmentId: "unselected" },
    { ...subtitleVersion.segments[0], id: "extra", sourceSegmentId: "segment" }]) {
    invoke.mockResolvedValue({ ...application, subtitleVersion: { ...subtitleVersion, segments: [...subtitleVersion.segments, extra] } });
    await expect(importTranslationResult(task.id, "fixture.json")).rejects.toThrow();
  }
});
