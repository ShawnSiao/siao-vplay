import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ExternalAgentResultUpdate } from "../../types";
import { useExternalAgentResults } from "./useExternalAgentResults";

const updates: ExternalAgentResultUpdate[] = [{ taskId: "task", projectId: "old-video", taskKind: "translation", status: "completed", outputId: "version", message: "private" }];
it("delivers a consumed result to the latest handler when the video changes during reconciliation", async () => {
  let finish!: (value: ExternalAgentResultUpdate[]) => void;
  const reconcile = vi.fn(() => new Promise<ExternalAgentResultUpdate[]>(resolve => { finish = resolve; }));
  const oldHandler = vi.fn(); const currentHandler = vi.fn();
  const { rerender } = renderHook(({ handler }) => useExternalAgentResults({ enabled: true, reconcile, onUpdates: handler }), { initialProps: { handler: oldHandler } });
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
  const { unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, onUpdates: handler }));
  unmount();
  await act(async () => finish(updates));
  expect(handler).not.toHaveBeenCalled();
});

it("does not restart the scan on unrelated render updates", async () => {
  const reconcile = vi.fn(async () => []);
  const { rerender } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, onUpdates: () => undefined }));
  await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
  await act(async () => { rerender(); });
  expect(reconcile).toHaveBeenCalledTimes(1);
});

it("retains the in-flight result across StrictMode effect replay", async () => {
  let finish!: (value: ExternalAgentResultUpdate[]) => void;
  const reconcile = vi.fn(() => new Promise<ExternalAgentResultUpdate[]>(resolve => { finish = resolve; }));
  const handler = vi.fn();
  renderHook(() => useExternalAgentResults({ enabled: true, reconcile, onUpdates: handler }), { wrapper: StrictMode });
  await act(async () => finish(updates));
  expect(handler).toHaveBeenCalledWith(updates, expect.any(Function));
  expect(reconcile).toHaveBeenCalledTimes(1);
});

it("invalidates asynchronous consumer work when disabled", async () => {
  let isActive!: () => boolean;
  const reconcile = vi.fn(async () => updates);
  const handler = vi.fn((_updates: ExternalAgentResultUpdate[], live: () => boolean) => { isActive = live; });
  const { rerender } = renderHook(({ enabled }) => useExternalAgentResults({ enabled, reconcile, onUpdates: handler }), { initialProps: { enabled: true } });
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
  const { unmount } = renderHook(() => useExternalAgentResults({ enabled: true, reconcile, onUpdates: handler }));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(reconcile).toHaveBeenCalledTimes(1);
    await act(async () => { fail(new Error("temporary scan failure")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(updates, expect.any(Function));
  } finally { unmount(); vi.useRealTimers(); }
});
