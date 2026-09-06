import { beforeEach, expect, it, vi } from "vitest";
import type { LearningTask, SubtitleVersion } from "../../types";
import { getSubtitleVersion } from "../../lib/desktop";
import { readLearningTaskContext } from "./learningTaskContext";
import type { LearningContext } from "./learningContext";

vi.mock("../../lib/desktop", () => ({ getSubtitleVersion: vi.fn() }));
const original = { id: "old", projectId: "project", role: "original", segments: [
  { id: "line", text: "Historical sentence.", startMs: 1000, endMs: 4000 },
] } as SubtitleVersion;
const translated = { id: "translated", projectId: "project", role: "translation", segments: [
  { id: "translated-line", sourceSegmentId: "line", text: "历史台词。" },
] } as SubtitleVersion;
const task = { id: "task", projectId: "project", sourceVersionId: "old", translationVersionId: null,
  sourceSegmentId: "line", selectedText: "Historical", playbackPositionMs: 3000 } as LearningTask;
const current: LearningContext = { projectId: "project", playbackPositionMs: 20000, sourceVersion: null,
  translationVersion: translated, sourceSegment: null, translationSegment: translated.segments[0] };
beforeEach(() => { vi.mocked(getSubtitleVersion).mockReset(); });

it("reads the requested historical version and does not attach a newer translation", async () => {
  vi.mocked(getSubtitleVersion).mockResolvedValue(original);
  const result = await readLearningTaskContext(task, current);
  expect(getSubtitleVersion).toHaveBeenCalledExactlyOnceWith("project", "old");
  expect(result.sourceSegment).toBe(original.segments[0]);
  expect(result.playbackPositionMs).toBe(3000);
  expect(result.translationVersion).toBeNull();
  expect(result.translationSegment).toBeNull();
});
it("reuses exact versions and matches translation by original segment", async () => {
  const result = await readLearningTaskContext({ ...task, translationVersionId: "translated" }, { ...current, sourceVersion: original });
  expect(getSubtitleVersion).not.toHaveBeenCalled();
  expect(result.translationSegment).toBe(translated.segments[0]);
});
it("rejects a task for another project without reading its data", async () => {
  await expect(readLearningTaskContext({ ...task, projectId: "other" }, current)).rejects.toThrow("当前视频");
  expect(getSubtitleVersion).not.toHaveBeenCalled();
});
it.each([
  { ...original, id: "wrong" }, { ...original, projectId: "wrong" }, { ...original, role: "translation" },
])("rejects a mismatched returned version", async (value) => {
  vi.mocked(getSubtitleVersion).mockResolvedValue(value as SubtitleVersion);
  await expect(readLearningTaskContext(task, current)).rejects.toThrow("版本不匹配");
});
it.each([
  { sourceSegmentId: "missing" }, { selectedText: "unrelated" }, { selectedText: " " },
  { playbackPositionMs: 999 }, { playbackPositionMs: Number.NaN },
])("rejects a missing sentence or invalid cutoff", async (change) => {
  await expect(readLearningTaskContext({ ...task, ...change }, { ...current, sourceVersion: original })).rejects.toThrow("范围不匹配");
});
