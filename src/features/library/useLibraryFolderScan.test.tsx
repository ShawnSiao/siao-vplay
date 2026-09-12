import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLibraryFolderScan } from "./useLibraryFolderScan";
import { scanPreview } from "./libraryControllerTestFixtures";
import type { LibraryScanPreview } from "../../types";
const mocks = vi.hoisted(() => ({ scanLibraryFolder: vi.fn(), cancelLibraryScan: vi.fn(), listenLibraryScanProgress: vi.fn() }));
vi.mock("./libraryGateway", () => mocks);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cancelLibraryScan.mockResolvedValue(undefined);
  mocks.listenLibraryScanProgress.mockResolvedValue(() => undefined);
});
it.each([false, true])("releases an unfinished scan and suppresses late completion on unmount (failure=%s)", async failure => {
  const pending = deferred<LibraryScanPreview>();
  mocks.scanLibraryFolder.mockReturnValue(pending.promise);
  const dispatch = vi.fn();
  const hook = renderHook(() => useLibraryFolderScan(dispatch));
  let operation!: Promise<unknown>;
  act(() => { operation = hook.result.current.startFolderScan("W:/media"); });
  const id = mocks.scanLibraryFolder.mock.calls[0][0].scanId;
  hook.unmount();
  dispatch.mockClear();
  await act(async () => { if (failure) pending.reject(new Error("late")); else pending.resolve(scanPreview); await operation; });
  expect(dispatch).not.toHaveBeenCalled();
  expect(mocks.cancelLibraryScan).toHaveBeenCalledWith(id);
});
it("cancels a superseded scan and keeps only the current preview", async () => {
  const first = deferred<LibraryScanPreview>();
  mocks.scanLibraryFolder.mockReturnValueOnce(first.promise).mockResolvedValueOnce(scanPreview);
  const dispatch = vi.fn();
  const hook = renderHook(() => useLibraryFolderScan(dispatch));
  let old!: Promise<unknown>;
  act(() => { old = hook.result.current.startFolderScan("W:/old"); });
  const id = mocks.scanLibraryFolder.mock.calls[0][0].scanId;
  await act(async () => { await hook.result.current.startFolderScan("W:/new"); });
  expect(mocks.cancelLibraryScan).toHaveBeenCalledWith(id);
  dispatch.mockClear();
  await act(async () => { first.resolve(scanPreview); await old; });
  expect(dispatch).not.toHaveBeenCalled();
});
it("releases a subscription that arrives after unmount", async () => {
  const listener = deferred<() => void>();
  mocks.listenLibraryScanProgress.mockReturnValue(listener.promise);
  const dispatch = vi.fn();
  const hook = renderHook(() => useLibraryFolderScan(dispatch));
  hook.unmount();
  const unlisten = vi.fn();
  await act(async () => { listener.resolve(unlisten); });
  expect(unlisten).toHaveBeenCalledTimes(1);
  expect(dispatch).not.toHaveBeenCalled();
});
