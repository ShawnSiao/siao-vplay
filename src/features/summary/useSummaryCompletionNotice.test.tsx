import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSummaryCompletionNotice } from "./useSummaryCompletionNotice";
const gateway = vi.hoisted(() => ({ listSummaryActivity: vi.fn() }));
vi.mock("../../lib/desktop", () => ({ isDesktopApp: true }));
vi.mock("./activityGateway", () => gateway);
afterEach(() => { vi.useRealTimers(); });
beforeEach(() => { vi.resetAllMocks(); });
it("reports a summary failure without exposing subtitle or model output", async () => {
  vi.useFakeTimers();
  const notice = vi.fn();
  gateway.listSummaryActivity.mockResolvedValueOnce([{ id: "a", projectId: "project-a", projectTitle: "视频 A", status: "running" }])
    .mockResolvedValue([{ id: "a", projectId: "project-a", projectTitle: "视频 A", status: "failed", errorMessage: "private subtitle material" }]);
  renderHook(() => useSummaryCompletionNotice(notice));
  await act(async () => { await Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(notice).toHaveBeenCalledOnce();
  expect(JSON.stringify(notice.mock.calls)).not.toContain("private subtitle material");
});

it("keeps a different project's result visible when the active view callback changes", async () => {
  vi.useFakeTimers();
  const watchingA = vi.fn(); const watchingB = vi.fn();
  gateway.listSummaryActivity.mockResolvedValueOnce([{ id: "a", projectId: "a", projectTitle: "视频 A", status: "running" }])
    .mockResolvedValue([{ id: "a", projectId: "a", projectTitle: "视频 A", status: "completed", hasResult: true }]);
  const { result, rerender } = renderHook(({ notice }) => useSummaryCompletionNotice(notice), { initialProps: { notice: watchingA } });
  await act(async () => { await Promise.resolve(); });
  rerender({ notice: watchingB });
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(watchingA).not.toHaveBeenCalled();
  expect(watchingB).toHaveBeenCalledWith(expect.objectContaining({ title: "「视频 A」的总结已完成" }));
  expect(result.current.activities[0].projectId).toBe("a");
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(watchingB).toHaveBeenCalledOnce();
});

it("retains the last known activities on a failed refresh and retries later", async () => {
  vi.useFakeTimers();
  gateway.listSummaryActivity.mockResolvedValueOnce([{ id: "a", status: "running" }])
    .mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue([{ id: "a", status: "interrupted" }]);
  const notice = vi.fn();
  const { result } = renderHook(() => useSummaryCompletionNotice(notice));
  await act(async () => { await Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(result.current.error).toBe(true);
  expect(result.current.activities[0].status).toBe("running");
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(result.current.error).toBe(false);
  expect(notice).toHaveBeenCalledOnce();
});
