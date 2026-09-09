import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLearningTaskFixture } from "../../test-fixtures/learning";
import { useLearningPolling } from "./useLearningPolling";
import type { LearningTask } from "../../types";
const task = createLearningTaskFixture();
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const options = () => ({ projectId: task.projectId, task, read: vi.fn< (id: string) => Promise<LearningTask> >(), onTask: vi.fn(), onError: vi.fn() });
it("keeps only one slow read in flight", async () => {
  const base = options(); base.read.mockReturnValue(new Promise(() => {}));
  const { unmount } = renderHook(() => useLearningPolling(base));
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(base.read).toHaveBeenCalledTimes(1);
  unmount();
});
it("rejects another task or project response", async () => {
  const base = options(); base.read.mockResolvedValue({ ...task, id: "other" });
  const { unmount } = renderHook(() => useLearningPolling(base));
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(base.onTask).not.toHaveBeenCalled();
  expect(base.onError).toHaveBeenCalled();
  unmount();
});
it("ignores an old response after the project changes", async () => {
  let resolve!: (value: LearningTask) => void;
  const base = options(); base.read.mockReturnValue(new Promise(done => { resolve = done; }));
  const { rerender, unmount } = renderHook(props => useLearningPolling(props), { initialProps: base });
  await act(async () => vi.advanceTimersByTimeAsync(800));
  rerender({ ...base, projectId: "other" });
  await act(async () => resolve(task));
  expect(base.onTask).not.toHaveBeenCalled();
  unmount();
});

it("uses latest handlers without restarting the pending read", async () => {
  let resolve!: (value: LearningTask) => void;
  const base = options(); base.read.mockReturnValue(new Promise(done => { resolve = done; }));
  const { rerender, unmount } = renderHook(props => useLearningPolling(props), { initialProps: base });
  await act(async () => vi.advanceTimersByTimeAsync(800));
  const onTask = vi.fn();
  rerender({ ...base, task: { ...task, progress: 0.5 }, onTask });
  await act(async () => resolve({ ...task, status: "completed" }));
  expect(onTask).toHaveBeenCalledTimes(1);
  expect(base.onTask).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(base.read).toHaveBeenCalledTimes(1);
  unmount();
});
it("recovers from a read error and stops after a terminal response", async () => {
  const base = options(); base.read.mockRejectedValueOnce(new Error("temporary")).mockResolvedValue({ ...task, status: "failed" });
  const { unmount } = renderHook(() => useLearningPolling(base));
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(base.read).toHaveBeenCalledTimes(2);
  expect(base.onError).toHaveBeenCalledTimes(1);
  expect(base.onTask).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  unmount();
});
it("drops late failures after unmount", async () => {
  let reject!: (cause: Error) => void;
  const base = options(); base.read.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const { unmount } = renderHook(() => useLearningPolling(base));
  await act(async () => vi.advanceTimersByTimeAsync(800));
  unmount();
  await act(async () => reject(new Error("late")));
  expect(base.onError).not.toHaveBeenCalled();
});
