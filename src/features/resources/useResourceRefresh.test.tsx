import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { catalog, setupStatus } from "../../test-fixtures/localResources";
import { createResourceTaskFixture } from "../../test-fixtures/resourceTask";
import type { LocalResourceStatus, ResourceNetworkStatus } from "../../types";
import { useLocalResources } from "./useLocalResources";
const mocks = vi.hoisted(() => ({ status: vi.fn(), network: vi.fn(), proxy: vi.fn(), listen: vi.fn() }));
vi.mock("../../lib/desktop", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/desktop")>(),
  getLocalResourceCatalog: async () => catalog,
  listResourceDownloadTasks: async () => ({ generation: 1, tasks: [] }),
  getLocalResourceStatus: mocks.status, getLocalResourceNetworkStatus: mocks.network,
  setLocalResourceProxy: mocks.proxy, listenResourceDownloadTasks: mocks.listen,
}));
const direct = { snapshotRevision: 1, mode: "direct" as const, proxySource: "direct" as const, proxyAddress: null };
const proxy = { snapshotRevision: 2, mode: "proxy" as const, proxySource: "custom" as const, proxyAddress: "http://127.0.0.1:7897" };
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.status.mockReset(); mocks.network.mockReset(); mocks.proxy.mockReset(); mocks.listen.mockReset();
  mocks.status.mockResolvedValue(setupStatus); mocks.network.mockResolvedValue(direct); mocks.proxy.mockResolvedValue(proxy); mocks.listen.mockResolvedValue(vi.fn());
});
afterEach(() => { vi.useRealTimers(); });
async function setup() { const view = renderHook(() => useLocalResources()); await act(async () => vi.advanceTimersByTimeAsync(0)); return view; }
it("keeps the new proxy when an older refresh network read returns", async () => {
  const view = await setup(); const old = deferred<ResourceNetworkStatus>(); mocks.network.mockReturnValueOnce(old.promise);
  let refreshing!: Promise<unknown>; act(() => { refreshing = view.result.current.refresh(); });
  await act(async () => { await view.result.current.setProxy(proxy.proxyAddress); });
  await act(async () => { old.resolve(direct); await refreshing; });
  expect(view.result.current.networkStatus).toEqual(proxy); view.unmount();
});
it("does not clear a newer proxy or show an old network read error", async () => {
  const view = await setup(); const old = deferred<ResourceNetworkStatus>(); mocks.network.mockReturnValueOnce(old.promise);
  let refreshing!: Promise<unknown>; act(() => { refreshing = view.result.current.refresh(); });
  await act(async () => { await view.result.current.setProxy(proxy.proxyAddress); });
  await act(async () => { old.reject(new Error("old network read")); await refreshing; });
  expect(view.result.current.networkStatus).toEqual(proxy); expect(view.result.current.error).toBeNull(); view.unmount();
});
it("ignores an older failed refresh after a newer refresh succeeds", async () => {
  const view = await setup(); const old = deferred<LocalResourceStatus>(); mocks.status.mockReturnValueOnce(old.promise);
  let failed!: Promise<unknown>; act(() => { failed = view.result.current.refresh().catch(cause => cause); });
  await act(async () => { await view.result.current.refresh(); });
  await act(async () => { old.reject(new Error("old read failure")); await failed; });
  expect(view.result.current.error).toBeNull(); view.unmount();
});
it("does not hide a newer operation failure when an older refresh succeeds", async () => {
  const view = await setup(); const old = deferred<LocalResourceStatus>(); mocks.status.mockReturnValueOnce(old.promise);
  let refreshing!: Promise<unknown>; act(() => { refreshing = view.result.current.refresh(); });
  mocks.proxy.mockRejectedValue(new Error("proxy save failed"));
  await act(async () => { await view.result.current.setProxy(proxy.proxyAddress).catch(() => undefined); });
  await act(async () => { old.resolve(setupStatus); await refreshing; });
  expect(view.result.current.error).toContain("proxy save failed"); expect(view.result.current.canRetryRead).toBe(false); view.unmount();
});
it("keeps initial loading until the latest refresh finishes", async () => {
  const first = deferred<LocalResourceStatus>(); const second = deferred<LocalResourceStatus>();
  mocks.status.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = renderHook(() => useLocalResources()); await act(async () => vi.advanceTimersByTimeAsync(0));
  let refreshing!: Promise<unknown>; act(() => { refreshing = view.result.current.refresh(); });
  await act(async () => first.resolve(setupStatus)); expect(view.result.current.loading).toBe(true);
  await act(async () => { second.resolve({ ...setupStatus, snapshotRevision: 2 }); await refreshing; });
  expect(view.result.current.loading).toBe(false); view.unmount();
});
it("does not report a late terminal-event read error after a successful setting change", async () => {
  const view = await setup(); const old = deferred<LocalResourceStatus>(); mocks.status.mockReturnValueOnce(old.promise);
  await act(async () => mocks.listen.mock.calls[0][0]({ ...createResourceTaskFixture(), state: "completed" }));
  await act(async () => { await view.result.current.setProxy(proxy.proxyAddress); });
  await act(async () => old.reject(new Error("old terminal read")));
  expect(view.result.current.error).toBeNull(); view.unmount();
});

it("returns the accepted network observation when an older proxy acknowledgement arrives", async () => {
  const view = await setup(); const old = deferred<ResourceNetworkStatus>(); mocks.proxy.mockReturnValueOnce(old.promise);
  let changing!: Promise<ResourceNetworkStatus>; act(() => { changing = view.result.current.setProxy(null); });
  await act(async () => { await view.result.current.setProxy(proxy.proxyAddress); });
  let accepted: ResourceNetworkStatus | undefined;
  await act(async () => { old.resolve(direct); accepted = await changing; });
  expect(accepted).toEqual(proxy); expect(view.result.current.networkStatus).toEqual(proxy); view.unmount();
});
it("keeps the latest proxy failure when an older proxy acknowledgement succeeds", async () => {
  const view = await setup(); const old = deferred<ResourceNetworkStatus>(); mocks.proxy.mockReturnValueOnce(old.promise);
  let changing!: Promise<ResourceNetworkStatus>; act(() => { changing = view.result.current.setProxy(null); });
  mocks.proxy.mockRejectedValueOnce(new Error("new proxy failure"));
  await act(async () => { await view.result.current.setProxy(proxy.proxyAddress).catch(() => undefined); });
  await act(async () => { old.resolve(direct); await changing; });
  expect(view.result.current.error).toContain("new proxy failure"); view.unmount();
});
