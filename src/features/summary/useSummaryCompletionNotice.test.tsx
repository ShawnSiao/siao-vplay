import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SummaryActivity } from "./activityGateway";
import { useSummaryCompletionNotice } from "./useSummaryCompletionNotice";
const gateway = vi.hoisted(() => ({ listSummaryActivity: vi.fn() }));
vi.mock("../../lib/desktop", () => ({ isDesktopApp: true }));
vi.mock("./activityGateway", () => gateway);
const activity = (status: SummaryActivity["status"]): SummaryActivity => ({ id: "a", projectId: "a", projectTitle: "视频 A", status, hasResult: status === "completed", updatedAtMs: 1 });
const snapshot = (...activities: SummaryActivity[]) => ({ activities, incomplete: false });

afterEach(() => { vi.useRealTimers(); });
beforeEach(() => { vi.resetAllMocks(); });
it("reports a summary failure without exposing subtitle or model output", async () => {
  vi.useFakeTimers();
  const notice = vi.fn();
  gateway.listSummaryActivity.mockResolvedValueOnce(snapshot(activity("running")))
    .mockResolvedValue(snapshot({ ...activity("failed"), errorMessage: "private subtitle material" }));
  renderHook(() => useSummaryCompletionNotice(notice));
  await act(async () => { await Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(notice).toHaveBeenCalledOnce();
  expect(JSON.stringify(notice.mock.calls)).not.toContain("private subtitle material");
});

it("keeps a different project's result visible when the active view callback changes", async () => {
  vi.useFakeTimers();
  const watchingA = vi.fn(); const watchingB = vi.fn();
  gateway.listSummaryActivity.mockResolvedValueOnce(snapshot(activity("running")))
    .mockResolvedValue(snapshot(activity("completed")));
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
  gateway.listSummaryActivity.mockResolvedValueOnce(snapshot(activity("running")))
    .mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue(snapshot(activity("interrupted")));
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


it("reports completion when its previously unavailable result becomes available", async () => {
  vi.useFakeTimers();
  gateway.listSummaryActivity.mockResolvedValueOnce(snapshot({ ...activity("completed"), hasResult: false })).mockResolvedValue(snapshot(activity("completed")));
  const notice = vi.fn();
  renderHook(() => useSummaryCompletionNotice(notice));
  await act(async () => { await Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(notice).toHaveBeenCalledWith(expect.objectContaining({ title: "「视频 A」的总结已完成" }));
});

it("exposes partial validation separately from a transport failure", async () => {
  gateway.listSummaryActivity.mockResolvedValue({ activities: [activity("running")], incomplete: true });
  const { result } = renderHook(() => useSummaryCompletionNotice(vi.fn()));
  await act(async () => { await Promise.resolve(); });
  expect(result.current.activities).toHaveLength(1);
  expect(result.current.incomplete).toBe(true);
  expect(result.current.error).toBe(false);
});


it("does not renotify a known completion after a partially invalid refresh", async () => {
  vi.useFakeTimers();
  gateway.listSummaryActivity.mockResolvedValueOnce(snapshot(activity("completed")))
    .mockResolvedValueOnce({ activities: [], incomplete: true }).mockResolvedValue(snapshot(activity("completed")));
  const notice = vi.fn();
  renderHook(() => useSummaryCompletionNotice(notice));
  await act(async () => { await Promise.resolve(); });
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(notice).not.toHaveBeenCalled();
});
