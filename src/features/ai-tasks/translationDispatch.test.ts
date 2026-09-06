import { beforeEach, expect, it, vi } from "vitest";
import { createTranslationTask, translationDispatchFixture } from "../../test-fixtures/translation";
import { previewTranslationDispatch } from "./translationDispatch";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const source = { id: "source", versionNumber: 2, segments: [{ id: "segment", startMs: 10, endMs: 20 }] };
const task = createTranslationTask("project", source);
beforeEach(() => vi.resetAllMocks());

it("reads the actual translation scope without invoking a runner", async () => {
  const preview = translationDispatchFixture(task, source);
  mocks.invoke.mockResolvedValue(preview);
  expect(await previewTranslationDispatch(task.id)).toEqual(preview);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("preview_translation_dispatch", { input: { taskId: task.id } });
});

it.each(["wrong-task", "missing-hash", "invalid-time", "duplicate-segment", "empty-scope"])("rejects %s without sending", async (scenario) => {
  const preview = translationDispatchFixture(task, source);
  if (scenario === "wrong-task") preview.taskId = "another";
  if (scenario === "missing-hash") preview.confirmationSha256 = "";
  if (scenario === "invalid-time") preview.segments[0].endMs = -1;
  if (scenario === "duplicate-segment") preview.segments.push(preview.segments[0]);
  if (scenario === "empty-scope") preview.segments = [];
  mocks.invoke.mockResolvedValue(preview);
  await expect(previewTranslationDispatch(task.id)).rejects.toThrow("翻译清单无效");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
