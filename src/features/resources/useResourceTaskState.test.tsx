import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createResourceTaskFixture } from "../../test-fixtures/resourceTask";
import { mergeResourceSnapshot, useResourceTaskState } from "./useResourceTaskState";
const task = createResourceTaskFixture();
afterEach(() => { vi.useRealTimers(); });
it("preserves newer and newly emitted tasks missing from an older same-root snapshot", () => {
  const newer = { ...task, revision: 3, state: "completed" as const };
  const added = { ...task, id: "new-task" };
  const current = { generation: 1, tasks: [newer, added] };
  expect(mergeResourceSnapshot(current, { generation: 1, tasks: [task] })).toBe(current);
});
it("clears old tasks on an empty newer binding and rejects late old-root events", () => {
  const { result } = renderHook(() => useResourceTaskState());
  act(() => { result.current.mergeTask(task); });
  act(() => { result.current.adoptSnapshot({ generation: 2, tasks: [] }); });
  expect(result.current.tasks).toEqual([]); expect(result.current.taskMetrics).toEqual({});
  act(() => { result.current.mergeTask({ ...task, revision: 999 }); });
  expect(result.current.tasks).toEqual([]);
});
it("accepts a newer binding event before its list arrives, with a lower task revision", () => {
  const current = { generation: 1, tasks: [{ ...task, revision: 99 }] };
  const reset = { ...task, generation: 2, revision: 1 };
  const first = mergeResourceSnapshot(current, { generation: 2, tasks: [reset] });
  expect(first.tasks).toEqual([reset]);
  expect(mergeResourceSnapshot(first, { generation: 1, tasks: [task] })).toBe(first);
});
it("ignores duplicate and older samples without changing speed or observation time", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const { result } = renderHook(() => useResourceTaskState());
  const initial = { ...task, state: "downloading" as const };
  act(() => { result.current.mergeTask(initial); });
  vi.setSystemTime(1000);
  act(() => { result.current.mergeTask({ ...initial, revision: 2, downloadedBytes: 20 }); });
  expect(result.current.taskMetrics[task.id].bytesPerSecond).toBe(20);
  const previous = result.current.taskMetrics;
  vi.setSystemTime(1500);
  act(() => { result.current.mergeTask({ ...initial, revision: 2, downloadedBytes: 20 }); result.current.mergeTask(initial); });
  expect(result.current.taskMetrics).toBe(previous);
  vi.setSystemTime(2000);
  act(() => { result.current.mergeTask({ ...initial, revision: 3, downloadedBytes: 40 }); });
  expect(result.current.taskMetrics[task.id].bytesPerSecond).toBe(20);
});
it("resets speed when a task is retried or the root is rebound", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const { result } = renderHook(() => useResourceTaskState());
  const initial = { ...task, state: "downloading" as const };
  act(() => { result.current.mergeTask(initial); }); vi.setSystemTime(1000);
  act(() => { result.current.mergeTask({ ...initial, revision: 2, downloadedBytes: 20 }); });
  act(() => { result.current.mergeTask({ ...initial, revision: 3, attempt: 2, downloadedBytes: 20 }); });
  expect(result.current.taskMetrics[task.id].bytesPerSecond).toBe(0);
  act(() => { result.current.mergeTask({ ...initial, generation: 2, revision: 1 }); });
  expect(result.current.taskMetrics[task.id].bytesPerSecond).toBe(0);
});
