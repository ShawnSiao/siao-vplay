import { resourceMovePlan } from "../../test-fixtures/resourceMove";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { catalog, setupStatus } from "../../test-fixtures/localResources";
import { useLocalResources } from "./useLocalResources";
const mocks = vi.hoisted(() => ({ status: vi.fn(), move: vi.fn(), tasks: vi.fn() }));
vi.mock("../../lib/desktop", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/desktop")>(),
  getLocalResourceCatalog: async () => catalog,
  listResourceDownloadTasks: mocks.tasks,
  getLocalResourceNetworkStatus: async () => ({ snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null }),
  listenResourceDownloadTasks: async () => vi.fn(),
  getLocalResourceStatus: mocks.status, moveLocalResourceRoot: mocks.move,
}));
beforeEach(() => { mocks.status.mockReset().mockResolvedValue(setupStatus); mocks.move.mockReset(); mocks.tasks.mockReset().mockResolvedValue({ generation: 1, tasks: [] }); });
const acknowledgement = { planFingerprint: resourceMovePlan.planFingerprint, requestId: "test-request", previousRoot: "W:/old", currentRoot: "W:/new", copiedBytes: 10,
  verifiedFileCount: 1, crossVolume: false, previousRootRetained: true };
it.each(["status", "tasks"] as const)("retains move acknowledgement when %s refresh fails and recovers on retry", async kind => {
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  mocks.move.mockResolvedValue(acknowledgement); mocks[kind].mockRejectedValueOnce(new Error("read unavailable"));
  let result: unknown;
  await act(async () => { result = await view.result.current.moveLocation(resourceMovePlan).catch(error => error); });
  expect(result).toEqual(acknowledgement); expect(view.result.current.error).toContain("移动已完成");
  expect(view.result.current.moving).toBe(false); expect(view.result.current.canRetryRead).toBe(true);
  await act(async () => { await view.result.current.refresh(); }); expect(view.result.current.error).toBeNull(); expect(view.result.current.canRetryRead).toBe(false);
  expect(mocks.move).toHaveBeenCalledOnce(); view.unmount();
});
it("does not let an old move refresh replace a newer successful refresh", async () => {
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  mocks.move.mockResolvedValue(acknowledgement);
  let reject!: (cause: Error) => void;
  mocks.status.mockReturnValueOnce(new Promise<never>((_, fail) => { reject = fail; }));
  let moving!: Promise<unknown>; await act(async () => { moving = view.result.current.moveLocation(resourceMovePlan).catch(error => error); });
  await act(async () => { await view.result.current.refresh(); });
  await act(async () => { reject(new Error("old read failed")); expect(await moving).toEqual(acknowledgement); });
  expect(view.result.current.error).toBeNull(); expect(view.result.current.canRetryRead).toBe(false); view.unmount();
});
