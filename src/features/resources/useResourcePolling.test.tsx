import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { catalog, setupStatus } from "../../test-fixtures/localResources";
import { createResourceTaskFixture } from "../../test-fixtures/resourceTask";
import type { ResourceDownloadTask, ResourceDownloadSnapshot } from "../../types";
import { useResourcePolling } from "./useResourcePolling";
import { useLocalResources } from "./useLocalResources";
const mocks = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn(), listen: vi.fn(), network: vi.fn(), profile: vi.fn() }));
vi.mock("../../lib/desktop", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/desktop")>(),
  getLocalResourceCatalog: async () => catalog,
  getLocalResourceNetworkStatus: mocks.network,
  getLocalResourceStatus: mocks.status,
  setLocalResourceProfile: mocks.profile,
  listResourceDownloadTasks: mocks.list,
  listenResourceDownloadTasks: mocks.listen,
}));
const task = { ...createResourceTaskFixture(), state: "downloading" as const };
function deferred() {
  let resolve!: (value: ResourceDownloadTask[]) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<ResourceDownloadSnapshot>((done, fail) => { resolve = tasks => done({ generation: 1, tasks }); reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.profile.mockReset(); mocks.network.mockReset(); mocks.network.mockResolvedValue({ mode: "direct", proxySource: "direct", proxyAddress: null }); mocks.list.mockReset(); mocks.status.mockReset(); mocks.listen.mockReset();
  mocks.list.mockResolvedValue({ generation: 1, tasks: [task] }); mocks.status.mockResolvedValue(setupStatus); mocks.listen.mockResolvedValue(vi.fn());
});
afterEach(() => { vi.useRealTimers(); });
async function setup() {
  const view = renderHook(() => useLocalResources());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(view.result.current.tasks).toEqual([task]);
  mocks.list.mockClear(); mocks.status.mockClear();
  return view;
}
it("does not overlap slow resource list reads", async () => {
  const view = await setup(); const pending = deferred(); mocks.list.mockReturnValue(pending.promise);
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(mocks.list).toHaveBeenCalledTimes(1);
  view.unmount(); await act(async () => pending.resolve([task]));
});
it("drops an in-flight snapshot when a terminal event stops polling", async () => {
  const view = await setup(); const pending = deferred(); mocks.list.mockReturnValue(pending.promise);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  const completed = { ...task, state: "completed" as const, revision: 2 };
  await act(async () => mocks.listen.mock.calls[0][0](completed));
  await act(async () => pending.resolve([task]));
  expect(view.result.current.tasks).toEqual([completed]);
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(mocks.list).toHaveBeenCalledTimes(1); view.unmount();
});
it("waits after settlement, retries read failures, and continues after progress events", async () => {
  const view = await setup(); const pending = deferred(); mocks.list.mockReturnValueOnce(pending.promise).mockResolvedValue({ generation: 1, tasks: [task] });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => mocks.listen.mock.calls[0][0]({ ...task, downloadedBytes: 50, revision: 2 }));
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  await act(async () => pending.reject(new Error("temporary read failure")));
  expect(view.result.current.error).toContain("temporary read failure");
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(999));
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(mocks.list).toHaveBeenCalledTimes(2); view.unmount();
});

it("does not start another batch when one read fails while its sibling is pending", async () => {
  const view = await setup(); const pending = deferred(); mocks.list.mockReturnValue(pending.promise);
  mocks.status.mockRejectedValue(new Error("status unavailable"));
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve([task]));
  expect(view.result.current.error).toContain("status unavailable"); view.unmount();
});

it("uses latest handlers and drops late failures after unmount", async () => {
  const first = deferred(); const second = deferred();
  mocks.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const base = { enabled: true, onSnapshot: vi.fn(), onError: vi.fn() };
  const view = renderHook(props => useResourcePolling(props), { initialProps: base });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  const onSnapshot = vi.fn(); view.rerender({ ...base, onSnapshot });
  await act(async () => first.resolve([task]));
  expect(base.onSnapshot).not.toHaveBeenCalled(); expect(onSnapshot).toHaveBeenCalledWith({ generation: 1, tasks: [task] }, setupStatus);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  view.unmount(); await act(async () => second.reject(new Error("late failure")));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(base.onError).not.toHaveBeenCalled(); expect(mocks.list).toHaveBeenCalledTimes(2);
});

it("keeps a newer task when another active task keeps polling enabled", async () => {
  const newer = { ...task, generation: 1, revision: 2, state: "completed" as const };
  const older = { ...task, generation: 1, revision: 1 };
  const other = { ...older, id: "other-task" };
  mocks.list.mockResolvedValue({ generation: 1, tasks: [older, other] });
  const view = renderHook(() => useLocalResources());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const pending = deferred(); mocks.list.mockReturnValue(pending.promise);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => mocks.listen.mock.calls[0][0](newer));
  await act(async () => pending.resolve([older, other]));
  expect(view.result.current.tasks.find(value => value.id === task.id)).toEqual(newer); view.unmount();
});
it("rejects an older event even when wall-clock timestamps are identical", async () => {
  const view = await setup();
  const newer = { ...task, generation: 1, revision: 3, downloadedBytes: 80 };
  await act(async () => mocks.listen.mock.calls[0][0](newer));
  await act(async () => mocks.listen.mock.calls[0][0]({ ...newer, revision: 2, downloadedBytes: 40 }));
  expect(view.result.current.tasks).toEqual([newer]); view.unmount();
});

it("keeps resources available but never fabricates direct networking after a failed read", async () => {
  mocks.network.mockRejectedValue(new Error("network status unavailable"));
  const view = await setup();
  expect(view.result.current.status).toEqual(setupStatus);
  expect(view.result.current.networkStatus).toBeNull();
  expect(view.result.current.error).toContain("network status unavailable");
  mocks.network.mockResolvedValue({ mode: "proxy", proxySource: "environment", proxyAddress: null });
  await act(async () => { await view.result.current.refresh(); });
  expect(view.result.current.networkStatus?.proxySource).toBe("environment");
  expect(view.result.current.error).toBeNull(); view.unmount();
});

it("does not overwrite a selected profile with an older refresh response", async () => {
  const view = await setup();
  let resolve!: (value: typeof setupStatus) => void;
  mocks.status.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  let refreshing!: Promise<unknown>;
  act(() => { refreshing = view.result.current.refresh(); });
  const selected = { ...setupStatus, snapshotRevision: 3, preferredProfile: "fast" };
  mocks.profile.mockResolvedValue(selected);
  await act(async () => { await view.result.current.selectProfile("fast"); });
  await act(async () => { resolve({ ...setupStatus, snapshotRevision: 2 }); await refreshing; });
  expect(view.result.current.status).toEqual(selected);
  expect(await refreshing).toEqual(selected); view.unmount();
});
it("ignores a lower status revision returned by a later-finishing refresh", async () => {
  const view = await setup();
  let resolve!: (value: typeof setupStatus) => void;
  mocks.status.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  let first!: Promise<unknown>; act(() => { first = view.result.current.refresh(); });
  const newer = { ...setupStatus, snapshotRevision: 4, resourceRoot: "W:\\NewRoot", rootState: "ready" as const };
  mocks.status.mockResolvedValue(newer);
  await act(async () => { await view.result.current.refresh(); });
  await act(async () => { resolve({ ...setupStatus, snapshotRevision: 2 }); await first; });
  expect(view.result.current.status).toEqual(newer); view.unmount();
});
