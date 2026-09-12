import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { CodexRuntimeStatus } from "../../types";
import { useCodexDetection } from "./useCodexDetection";

const ready: CodexRuntimeStatus = { available: true, supported: true, authenticated: true,
  version: "1", minimumVersion: "1", authMode: "chatgpt", errorCode: null, errorMessage: null };

it("keeps failed detection unknown and retries only the supplied executor read", async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error("private transport details")).mockResolvedValue(ready);
  const { result } = renderHook(() => useCodexDetection(read));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.runtime).toBeNull();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.runtime).toEqual(ready));
  expect(result.current.failed).toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
});

it("rejects an obsolete response after retry starts a newer read", async () => {
  let finish!: (status: CodexRuntimeStatus) => void;
  const read = vi.fn().mockReturnValueOnce(new Promise<CodexRuntimeStatus>(resolve => { finish = resolve; }))
    .mockRejectedValue(new Error("new failure"));
  const { result } = renderHook(() => useCodexDetection(read));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.failed).toBe(true));
  await act(async () => finish(ready));
  expect(result.current.runtime).toBeNull();
});

it("does not begin detection after its consumer unmounts before the scheduled read", async () => {
  const read = vi.fn().mockResolvedValue(ready);
  const { unmount } = renderHook(() => useCodexDetection(read));
  unmount();
  await act(async () => undefined);
  expect(read).not.toHaveBeenCalled();
});
