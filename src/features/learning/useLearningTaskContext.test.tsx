import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { LearningTask } from "../../types";
import type { LearningContext } from "./learningContext";
import { readLearningTaskContext } from "./learningTaskContext";
import { useLearningTaskContext } from "./useLearningTaskContext";
vi.mock("./learningTaskContext", () => ({ readLearningTaskContext: vi.fn() }));
vi.mock("../../lib/desktop", () => ({ commandError: (error: Error) => error }));
const task = { id: "task", status: "interrupted", selectedText: "old" } as LearningTask;
const context = { projectId: "project" } as LearningContext;
beforeEach(() => { vi.mocked(readLearningTaskContext).mockReset(); });

it("blocks until recovery succeeds, permits retry, and ignores progress-only updates", async () => {
  const restore = vi.fn();
  vi.mocked(readLearningTaskContext).mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(context);
  const { result, rerender } = renderHook(({ task }) => useLearningTaskContext(task, context, restore), { initialProps: { task } });
  expect(result.current.blocked).toBe(true);
  await waitFor(() => expect(result.current.error).toBe("read failed"));
  expect(restore).not.toHaveBeenCalled();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.blocked).toBe(false));
  expect(restore).toHaveBeenCalledExactlyOnceWith(context, "old");
  rerender({ task: { ...task, status: "running" } });
  expect(readLearningTaskContext).toHaveBeenCalledTimes(2);
});
it("does not apply late recovery after the task was cleared", async () => {
  let resolve!: (value: LearningContext) => void;
  vi.mocked(readLearningTaskContext).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const restore = vi.fn();
  const { result, rerender } = renderHook(({ task }: { task: LearningTask | null }) => useLearningTaskContext(task, context, restore), { initialProps: { task: task as LearningTask | null } });
  rerender({ task: null });
  await act(async () => resolve(context));
  expect(restore).not.toHaveBeenCalled();
  expect(result.current.blocked).toBe(false);
});
it("does not apply recovery after the project session unmounts", async () => {
  let resolve!: (value: LearningContext) => void;
  vi.mocked(readLearningTaskContext).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const restore = vi.fn();
  const { unmount } = renderHook(() => useLearningTaskContext(task, context, restore));
  unmount();
  await act(async () => resolve(context));
  expect(restore).not.toHaveBeenCalled();
});
