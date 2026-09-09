import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { catalog, setupStatus } from "../../test-fixtures/localResources";
import { useLocalResources } from "./useLocalResources";
const mocks = vi.hoisted(() => ({ status: vi.fn(), unused: vi.fn(), old: vi.fn() }));
vi.mock("../../lib/desktop", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/desktop")>(),
  getLocalResourceCatalog: async () => catalog,
  listResourceDownloadTasks: async () => ({ generation: 1, tasks: [] }),
  getLocalResourceNetworkStatus: async () => ({ snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null }),
  listenResourceDownloadTasks: async () => vi.fn(),
  getLocalResourceStatus: mocks.status, cleanupUnusedResources: mocks.unused, cleanupOldResourceVersions: mocks.old,
}));
beforeEach(() => { mocks.status.mockReset().mockResolvedValue(setupStatus); mocks.unused.mockReset(); mocks.old.mockReset(); });
it.each(["unused", "old"] as const)("retains %s cleanup acknowledgement when status refresh fails", async kind => {
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  const acknowledgement = kind === "unused" ? { removedResourceIds: ["a"], reclaimedBytes: 10 } : { removedVersions: ["a@1"], reclaimedBytes: 10 };
  mocks[kind].mockResolvedValue(acknowledgement); mocks.status.mockRejectedValueOnce(new Error("status unavailable"));
  let result: unknown;
  await act(async () => { result = await (kind === "unused" ? view.result.current.cleanupUnused("a".repeat(64)) : view.result.current.cleanupOldVersions("a".repeat(64))).catch(error => error); });
  expect(result).toEqual(acknowledgement); expect(view.result.current.error).toContain("status unavailable");
  view.unmount();
});

it("clears the refresh warning after a successful explicit refresh", async () => {
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  mocks.unused.mockResolvedValue({ removedResourceIds: ["a"], reclaimedBytes: 10 }); mocks.status.mockRejectedValueOnce(new Error("status unavailable"));
  await act(async () => { await view.result.current.cleanupUnused("a".repeat(64)); });
  expect(view.result.current.error).toContain("清理结果已保留");
  await act(async () => { await view.result.current.refresh(); }); expect(view.result.current.error).toBeNull(); view.unmount();
});
it("keeps a command failure distinct from a refresh failure", async () => {
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  const reads = mocks.status.mock.calls.length; mocks.unused.mockRejectedValue(new Error("cleanup interrupted"));
  await act(async () => { await expect(view.result.current.cleanupUnused("a".repeat(64))).rejects.toThrow("cleanup interrupted"); });
  expect(mocks.status).toHaveBeenCalledTimes(reads); expect(view.result.current.error).toBe("cleanup interrupted"); view.unmount();
});
it("does not let an older cleanup refresh failure replace a newer successful refresh", async () => {
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  mocks.old.mockResolvedValue({ removedVersions: ["a@1"], reclaimedBytes: 10 });
  let reject!: (cause: Error) => void; const held = new Promise<never>((_, fail) => { reject = fail; }); mocks.status.mockReturnValueOnce(held);
  let cleaning!: Promise<unknown>; await act(async () => { cleaning = view.result.current.cleanupOldVersions("a".repeat(64)); });
  await act(async () => { await view.result.current.refresh(); });
  await act(async () => { reject(new Error("old refresh failed")); await cleaning; });
  expect(view.result.current.error).toBeNull(); view.unmount();
});
