import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { catalog, setupStatus } from "../../test-fixtures/localResources";
import { resourceLocationPlan as plan } from "../../test-fixtures/resourceLocation";
import { useLocalResources } from "./useLocalResources";
const mocks = vi.hoisted(() => ({ configure: vi.fn(), retry: vi.fn() }));
vi.mock("../../lib/desktop", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/desktop")>(),
  getLocalResourceCatalog: async () => catalog, getLocalResourceStatus: async () => setupStatus,
  listResourceDownloadTasks: async () => ({ generation: 1, tasks: [] }),
  getLocalResourceNetworkStatus: async () => ({ snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null }),
  listenResourceDownloadTasks: async () => vi.fn(), configureLocalResourceRoot: mocks.configure, retryLocalResourceBinding: mocks.retry,
}));
beforeEach(() => { mocks.configure.mockReset(); mocks.retry.mockReset(); });
it("keeps saved location and retries task binding without saving the location again", async () => {
  const failed = { ...setupStatus, snapshotRevision: 2, configured: true, rootState: "ready" as const, selectedParent: plan.selectedParent,
    resourceRoot: plan.resourceRoot, configurationFingerprint: "a".repeat(64), bindingError: "任务文件损坏", taskSnapshot: null };
  mocks.configure.mockResolvedValue(failed);
  const view = renderHook(() => useLocalResources());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => { await view.result.current.confirmLocation(plan); });
  expect(view.result.current.status?.resourceRoot).toBe(plan.resourceRoot);
  expect(view.result.current.bindingRecovery).toEqual(failed);
  const ready = { ...failed, snapshotRevision: 3, bindingError: null, taskSnapshot: { generation: 2, tasks: [] } };
  mocks.retry.mockResolvedValue(ready);
  await act(async () => { await view.result.current.retryBinding(); });
  expect(mocks.retry).toHaveBeenCalledWith(failed);
  expect(mocks.configure).toHaveBeenCalledTimes(1);
  expect(view.result.current.bindingRecovery).toBeNull();
  expect(view.result.current.status?.snapshotRevision).toBe(3);
  view.unmount();
});

it("does not replace newer recovery state with a late location result", async () => {
  const old = { ...setupStatus, configured: true, rootState: "ready" as const, selectedParent: plan.selectedParent, resourceRoot: plan.resourceRoot,
    configurationFingerprint: "a".repeat(64), bindingError: "old failure", taskSnapshot: null };
  const newer = { ...old, snapshotRevision: 3, bindingError: null, taskSnapshot: { generation: 3, tasks: [] } };
  let resolve!: (value: typeof old) => void;
  mocks.configure.mockReturnValueOnce(new Promise<typeof old>(done => { resolve = done; })).mockResolvedValueOnce(newer);
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  let first!: Promise<unknown>; await act(async () => { first = view.result.current.confirmLocation(plan); });
  await act(async () => { await view.result.current.confirmLocation(plan); });
  await act(async () => { resolve(old); await first; });
  expect(view.result.current.bindingRecovery).toBeNull();
  view.unmount();
});
