import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ExternalAgentResultUpdate } from "../../types";
import { useExternalAgentResults } from "./useExternalAgentResults";

const acknowledge = vi.fn(async () => undefined);
const updates: ExternalAgentResultUpdate[] = [{ taskId: "task", projectId: "old-video", taskKind: "translation", status: "completed", outputId: "version", message: "private" }];
it("delivers a consumed result to the latest handler when the video changes during reconciliation", async () => {
  let finish!: (value: ExternalAgentResultUpdate[]) => void;
  const reconcile = vi.fn(() => new Promise<ExternalAgentResultUpdate[]>(resolve => { finish = resolve; }));
  const oldHandler = vi.fn(); const currentHandler = vi.fn();
  const { rerender } = renderHook(({ handler }) => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: handler }), { initialProps: { handler: oldHandler } });
  await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
  rerender({ handler: currentHandler });
  await act(async () => finish(updates));
  expect(oldHandler).not.toHaveBeenCalled();
  expect(currentHandler).toHaveBeenCalledWith(updates, expect.any(Function));
  expect(reconcile).toHaveBeenCalledTimes(1);
});

it("does not deliver results after unmount", async () => {
  let finish!: (value: ExternalAgentResultUpdate[]) => void;
  const reconcile = vi.fn(() => new Promise<ExternalAgentResultUpdate[]>(resolve => { finish = resolve; }));
  const handler = vi.fn();
  const { unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: handler }));
  await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => finish(updates));
  expect(handler).not.toHaveBeenCalled();
});

it("does not restart the scan on unrelated render updates", async () => {
  const reconcile = vi.fn(async () => []);
  const { rerender } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: () => undefined }));
  await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
  await act(async () => { rerender(); });
  expect(reconcile).toHaveBeenCalledTimes(1);
});

it("retains the in-flight result across StrictMode effect replay", async () => {
  let finish!: (value: ExternalAgentResultUpdate[]) => void;
  const reconcile = vi.fn(() => new Promise<ExternalAgentResultUpdate[]>(resolve => { finish = resolve; }));
  const handler = vi.fn();
  renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: handler }), { wrapper: StrictMode });
  await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
  await act(async () => finish(updates));
  expect(handler).toHaveBeenCalledWith(updates, expect.any(Function));
  expect(reconcile).toHaveBeenCalledTimes(1);
});

it("invalidates asynchronous consumer work when disabled", async () => {
  let isActive!: () => boolean;
  const reconcile = vi.fn(async () => updates);
  const handler = vi.fn((_updates: ExternalAgentResultUpdate[], live: () => boolean) => { isActive = live; });
  const { rerender } = renderHook(({ enabled }) => useExternalAgentResults({ enabled, reconcile, acknowledge, onUpdates: handler }), { initialProps: { enabled: true } });
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  expect(isActive()).toBe(true);
  rerender({ enabled: false });
  expect(isActive()).toBe(false);
});

it("serializes slow scans and resumes polling after an error", async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  const first = new Promise<ExternalAgentResultUpdate[]>((_resolve, reject) => { fail = reject; });
  const reconcile = vi.fn().mockReturnValueOnce(first).mockResolvedValue(updates);
  const handler = vi.fn();
  const { unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: handler }));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(reconcile).toHaveBeenCalledTimes(1);
    await act(async () => { fail(new Error("temporary scan failure")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(updates, expect.any(Function));
  } finally { unmount(); vi.useRealTimers(); }
});


it("retries a durable completion on the next scan after the consumer fails", async () => {
  vi.useFakeTimers();
  const acknowledge = vi.fn(async () => undefined);
  const reconcile = vi.fn().mockResolvedValueOnce(updates).mockResolvedValueOnce(updates).mockResolvedValue([]);
  const handler = vi.fn().mockRejectedValueOnce(new Error("refresh failed")).mockResolvedValue(undefined);
  const { unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: handler }));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(acknowledge).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith(updates, expect.any(Function));
    expect(reconcile).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(reconcile).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenCalledTimes(2);
  } finally { unmount(); vi.useRealTimers(); }
});


it("redelivers a batch whose asynchronous consumer was disabled before completion", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const reconcile = vi.fn().mockResolvedValueOnce(updates).mockResolvedValue([]);
  const firstHandler = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const nextHandler = vi.fn(async () => undefined);
  const { rerender, unmount } = renderHook(({ enabled, handler }) => useExternalAgentResults({ enabled, reconcile, acknowledge, onUpdates: handler }), {
    initialProps: { enabled: true, handler: firstHandler },
  });
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender({ enabled: false, handler: firstHandler });
    await act(async () => { finish(); });
    rerender({ enabled: true, handler: nextHandler });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(nextHandler).toHaveBeenCalledWith(updates, expect.any(Function));
    expect(reconcile).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(reconcile).toHaveBeenCalledTimes(3);
    expect(nextHandler).toHaveBeenCalledTimes(1);
  } finally { unmount(); vi.useRealTimers(); }
});


it("does not discard delivery until acknowledgement succeeds", async () => {
  vi.useFakeTimers();
  const reconcile = vi.fn().mockResolvedValue(updates);
  const acknowledge = vi.fn().mockRejectedValueOnce(new Error("ack transport failed")).mockResolvedValue(undefined);
  const handler = vi.fn();
  const options = { enabled: true, reconcile, acknowledge, onUpdates: handler };
  const { unmount } = renderHook(() => useExternalAgentResults(options));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(acknowledge).toHaveBeenCalledWith(updates);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(2);
  } finally { unmount(); vi.useRealTimers(); }
});


it.each(["consumer", "acknowledgement"])("delivers independent results despite a persistent %s failure", async (failure) => {
  vi.useFakeTimers();
  const independent = { ...updates[0], taskId: "independent", projectId: "other-video" };
  const reconcile = vi.fn().mockResolvedValueOnce([...updates, independent]).mockResolvedValue(updates);
  const acknowledge = vi.fn(async (batch: ExternalAgentResultUpdate[]) => {
    if (failure === "acknowledgement" && batch[0].taskId === "task") throw new Error("ack failed");
  });
  const handler = vi.fn(async (batch: ExternalAgentResultUpdate[]) => {
    if (failure === "consumer" && batch.some(update => update.taskId === "task")) throw new Error("persistent read failure");
  });
  const { unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: handler }));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(acknowledge).toHaveBeenCalledWith([independent]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(acknowledge.mock.calls.filter(([batch]) => batch[0].taskId === "independent")).toHaveLength(1);
    expect(handler.mock.calls.filter(([batch]) => batch[0].taskId === "task")).toHaveLength(3);
  } finally { unmount(); vi.useRealTimers(); }
});


it("continues scanning for new completions while an older result keeps failing", async () => {
  vi.useFakeTimers();
  const next = { ...updates[0], taskId: "new-task" };
  const reconcile = vi.fn().mockResolvedValueOnce(updates).mockResolvedValue([next]);
  const acknowledge = vi.fn(async () => undefined);
  const handler = vi.fn(async (batch: ExternalAgentResultUpdate[]) => {
    if (batch[0].taskId === "task") throw new Error("persistent failure");
  });
  const { unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: handler }));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(acknowledge).toHaveBeenCalledWith([next]);
  } finally { unmount(); vi.useRealTimers(); }
});


it("replaces a failed transient notice with the newer completed state of the same task", async () => {
  vi.useFakeTimers();
  const transient: ExternalAgentResultUpdate = { ...updates[0], status: "validating", outputId: null };
  const reconcile = vi.fn().mockResolvedValueOnce([transient]).mockResolvedValue(updates);
  const acknowledge = vi.fn(async () => undefined);
  const handler = vi.fn().mockRejectedValueOnce(new Error("temporary consumer failure")).mockResolvedValue(undefined);
  const { unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: handler }));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith(updates, expect.any(Function));
    expect(acknowledge).toHaveBeenCalledWith(updates);
  } finally { unmount(); vi.useRealTimers(); }
});

it("still retries consumed transient notices when the next scan fails", async () => {
  vi.useFakeTimers();
  const transient: ExternalAgentResultUpdate = { ...updates[0], status: "rejected", outputId: null };
  const reconcile = vi.fn().mockResolvedValueOnce([transient]).mockRejectedValue(new Error("scan failed"));
  const acknowledge = vi.fn(async () => undefined);
  const handler = vi.fn().mockRejectedValueOnce(new Error("consumer failed")).mockResolvedValue(undefined);
  const { unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: handler }));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(acknowledge).toHaveBeenCalledWith([transient]);
  } finally { unmount(); vi.useRealTimers(); }
});


it.each(["scan", "delivery", "acknowledgement"])("exposes a safe %s failure and clears it after recovery", async phase => {
  const reconcile = vi.fn().mockResolvedValue(updates);
  const acknowledge = vi.fn(async () => undefined);
  const onUpdates = vi.fn(async () => undefined);
  const failing = phase === "scan" ? reconcile : phase === "delivery" ? onUpdates : acknowledge;
  failing.mockRejectedValueOnce(new Error("private W:/data/video.mp4"));
  const { result } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates }));
  await waitFor(() => expect(result.current.failure).toBe(phase));
  await act(async () => { await result.current.retry(); });
  expect(result.current.failure).toBeNull();
});


it("shares an in-flight manual retry instead of starting overlapping checks", async () => {
  let finish!: (value: ExternalAgentResultUpdate[]) => void;
  const reconcile = vi.fn().mockRejectedValueOnce(new Error("scan failed")).mockImplementation(() => new Promise<ExternalAgentResultUpdate[]>(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates: () => undefined }));
  await waitFor(() => expect(result.current.failure).toBe("scan"));
  let first!: Promise<void>; let second!: Promise<void>;
  act(() => { first = result.current.retry(); second = result.current.retry(); });
  expect(first).toBe(second);
  await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));
  await act(async () => { finish([]); await first; });
  expect(result.current.failure).toBeNull();
});

it("does not publish an old consumer failure after its lifetime was interrupted", async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  const reconcile = vi.fn().mockResolvedValue(updates);
  const onUpdates = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  const { result, rerender, unmount } = renderHook(({ enabled }) => useExternalAgentResults({ enabled, reconcile, acknowledge, onUpdates }), { initialProps: { enabled: true } });
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender({ enabled: false }); rerender({ enabled: true });
    await act(async () => { fail(new Error("old failure")); });
    expect(result.current.failure).toBeNull();
  } finally { unmount(); vi.useRealTimers(); }
});


it("publishes an observed failure before a later consumer finishes", async () => {
  vi.useFakeTimers();
  const reconcile = vi.fn().mockResolvedValue([...updates, { ...updates[0], taskId: "slow" }]);
  const onUpdates = vi.fn().mockRejectedValueOnce(new Error("first failure")).mockImplementation(() => new Promise<void>(() => undefined));
  const { result, unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, acknowledge, onUpdates }));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(onUpdates).toHaveBeenCalledTimes(2);
    expect(result.current.failure).toBe("delivery");
  } finally { unmount(); vi.useRealTimers(); }
});
