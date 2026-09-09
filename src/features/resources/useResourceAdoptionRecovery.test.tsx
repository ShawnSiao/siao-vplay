import { resourceAdoptionResult, resourceAdoptionPreview } from "../../test-fixtures/resourceAdoption";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { catalog, setupStatus } from "../../test-fixtures/localResources";
import { useLocalResources } from "./useLocalResources";
const mocks = vi.hoisted(() => ({ status: vi.fn(), adopt: vi.fn() }));
vi.mock("../../lib/desktop", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/desktop")>(),
  getLocalResourceCatalog: async () => catalog,
  listResourceDownloadTasks: async () => ({ generation: 1, tasks: [] }),
  getLocalResourceNetworkStatus: async () => ({ snapshotRevision: 1, mode: "direct", proxySource: "direct", proxyAddress: null }),
  listenResourceDownloadTasks: async () => vi.fn(),
  getLocalResourceStatus: mocks.status, adoptLocalResources: mocks.adopt,
}));
beforeEach(() => { mocks.status.mockReset().mockResolvedValue(setupStatus); mocks.adopt.mockReset(); });
it("retains adoption results when the following status refresh fails", async () => {
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  mocks.adopt.mockResolvedValue(resourceAdoptionResult); mocks.status.mockRejectedValueOnce(new Error("read unavailable"));
  let result: unknown; await act(async () => { result = await view.result.current.adoptResources(resourceAdoptionPreview).catch(error => error); });
  expect(result).toEqual(resourceAdoptionResult); expect(view.result.current.error).toContain("接管结果已保留");
  await act(async () => { await view.result.current.refresh(); }); expect(view.result.current.error).toBeNull(); view.unmount();
});

it("does not let an old adoption refresh replace a newer successful refresh", async () => {
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  mocks.adopt.mockResolvedValue(resourceAdoptionResult);
  let fail!: (cause: Error) => void; mocks.status.mockReturnValueOnce(new Promise<never>((_, reject) => { fail = reject; }));
  let adopting!: Promise<unknown>; await act(async () => { adopting = view.result.current.adoptResources(resourceAdoptionPreview); });
  await act(async () => { await view.result.current.refresh(); });
  await act(async () => { fail(new Error("old read")); expect(await adopting).toEqual(resourceAdoptionResult); });
  expect(view.result.current.error).toBeNull(); view.unmount();
});
it("keeps adoption command errors distinct from read recovery", async () => {
  const view = renderHook(() => useLocalResources()); await waitFor(() => expect(view.result.current.loading).toBe(false));
  const reads = mocks.status.mock.calls.length; mocks.adopt.mockRejectedValue(new Error("plan changed"));
  await act(async () => { await expect(view.result.current.adoptResources(resourceAdoptionPreview)).rejects.toThrow("plan changed"); });
  expect(view.result.current.canRetryRead).toBe(false); expect(mocks.status).toHaveBeenCalledTimes(reads); view.unmount();
});
