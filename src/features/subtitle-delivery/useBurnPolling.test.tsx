import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBurnJobFixture } from "../../test-fixtures/burn";
import { useBurnPolling } from "./useBurnPolling";
import type { SubtitleBurnJob } from "../../types";
const task: SubtitleBurnJob = createBurnJobFixture();
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const options = () => ({ projectId: task.projectId, task, read: vi.fn< (id: string) => Promise<SubtitleBurnJob> >(), onTask: vi.fn(), onError: vi.fn() });
it("keeps only one slow read in flight", async () => {
  const base = options(); base.read.mockReturnValue(new Promise(() => {}));
  const { unmount } = renderHook(() => useBurnPolling(base));
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(base.read).toHaveBeenCalledTimes(1);
  unmount();
});
it("rejects another task or project response", async () => {
  const base = options(); base.read.mockResolvedValue({ ...task, id: "other" });
  const { unmount } = renderHook(() => useBurnPolling(base));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(base.onTask).not.toHaveBeenCalled();
  expect(base.onError).toHaveBeenCalled();
  unmount();
});
it("ignores an old response after the project changes", async () => {
  let resolve!: (value: SubtitleBurnJob) => void;
  const base = options(); base.read.mockReturnValue(new Promise(done => { resolve = done; }));
  const { rerender, unmount } = renderHook(props => useBurnPolling(props), { initialProps: base });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  rerender({ ...base, projectId: "other" });
  await act(async () => resolve(task));
  expect(base.onTask).not.toHaveBeenCalled();
  unmount();
});

it("uses latest handlers without restarting the pending read", async () => {
  let resolve!: (value: SubtitleBurnJob) => void;
  const base = options(); base.read.mockReturnValue(new Promise(done => { resolve = done; }));
  const { rerender, unmount } = renderHook(props => useBurnPolling(props), { initialProps: base });
  await act(async () => vi.advanceTimersByTimeAsync(500));
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
  const { unmount } = renderHook(() => useBurnPolling(base));
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(base.read).toHaveBeenCalledTimes(2);
  expect(base.onError).toHaveBeenCalledTimes(1);
  expect(base.onTask).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  unmount();
});
it("drops late failures after unmount", async () => {
  let reject!: (cause: Error) => void;
  const base = options(); base.read.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const { unmount } = renderHook(() => useBurnPolling(base));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  unmount();
  await act(async () => reject(new Error("late")));
  expect(base.onError).not.toHaveBeenCalled();
});
