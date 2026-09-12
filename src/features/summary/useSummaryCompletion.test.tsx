import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createSummaryFixtures } from "../../test-fixtures/summary";
import { useSummaryCompletion } from "./useSummaryCompletion";
import type { VideoSummary } from "./types";

const fixture = createSummaryFixtures();
const task = { ...fixture.task, status: "completed" as const, outputSummaryId: fixture.summary.id };
it.each(["id", "taskId", "projectId", "subtitleVersionId", "materialManifestSha256", "scope", "playbackCutoffMs"])("rejects mismatched %s", async field => {
  const read = vi.fn().mockResolvedValue({ ...fixture.summary, [field]: "wrong" });
  const onResult = vi.fn();
  const { result } = renderHook(() => useSummaryCompletion({ projectId: task.projectId, task, read, onResult }));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(onResult).not.toHaveBeenCalled();
});
it("discards a pending result when another project takes ownership", async () => {
  let resolve!: (value: VideoSummary) => void;
  const read = vi.fn(() => new Promise<VideoSummary>(done => { resolve = done; }));
  const onResult = vi.fn();
  const { rerender } = renderHook(({ projectId }) => useSummaryCompletion({ projectId, task, read, onResult }),
    { initialProps: { projectId: task.projectId } });
  rerender({ projectId: "other" });
  await act(async () => resolve(fixture.summary));
  expect(onResult).not.toHaveBeenCalled();
});
it("keeps an in-flight read across equivalent task renders and uses the latest callback", async () => {
  let resolve!: (value: VideoSummary) => void;
  const read = vi.fn(() => new Promise<VideoSummary>(done => { resolve = done; }));
  const previous = vi.fn(); const latest = vi.fn();
  const { rerender } = renderHook(({ onResult }) => useSummaryCompletion({ projectId: task.projectId, task: { ...task }, read, onResult }),
    { initialProps: { onResult: previous } });
  rerender({ onResult: latest });
  await act(async () => resolve(fixture.summary));
  expect(read).toHaveBeenCalledTimes(1);
  expect(previous).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith(fixture.summary);
});
it("ignores a late error after unmount", async () => {
  let reject!: (cause: Error) => void;
  const read = vi.fn(() => new Promise<VideoSummary>((_, fail) => { reject = fail; }));
  const onResult = vi.fn();
  const { unmount } = renderHook(() => useSummaryCompletion({ projectId: task.projectId, task, read, onResult }));
  unmount();
  await act(async () => reject(new Error("late")));
  expect(onResult).not.toHaveBeenCalled();
});
