import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { catalog, setupStatus } from "../../test-fixtures/localResources";
import { createResourceTaskFixture } from "../../test-fixtures/resourceTask";
import type { ResourceDownloadTask } from "../../types";
import { useResourcePolling } from "./useResourcePolling";
import { useLocalResources } from "./useLocalResources";
const mocks = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn(), listen: vi.fn() }));
vi.mock("../../lib/desktop", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/desktop")>(),
  getLocalResourceCatalog: async () => catalog,
  getLocalResourceNetworkStatus: async () => ({ mode: "direct", proxySource: "direct", proxyAddress: null }),
  getLocalResourceStatus: mocks.status,
  listResourceDownloadTasks: mocks.list,
  listenResourceDownloadTasks: mocks.listen,
}));
const task = { ...createResourceTaskFixture(), state: "downloading" as const };
function deferred() {
  let resolve!: (value: ResourceDownloadTask[]) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<ResourceDownloadTask[]>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.list.mockReset(); mocks.status.mockReset(); mocks.listen.mockReset();
  mocks.list.mockResolvedValue([task]); mocks.status.mockResolvedValue(setupStatus); mocks.listen.mockResolvedValue(vi.fn());
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
  const completed = { ...task, state: "completed" as const };
  await act(async () => mocks.listen.mock.calls[0][0](completed));
  await act(async () => pending.resolve([task]));
  expect(view.result.current.tasks).toEqual([completed]);
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(mocks.list).toHaveBeenCalledTimes(1); view.unmount();
});
it("waits after settlement, retries read failures, and continues after progress events", async () => {
  const view = await setup(); const pending = deferred(); mocks.list.mockReturnValueOnce(pending.promise).mockResolvedValue([task]);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => mocks.listen.mock.calls[0][0]({ ...task, downloadedBytes: 50 }));
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
  expect(base.onSnapshot).not.toHaveBeenCalled(); expect(onSnapshot).toHaveBeenCalledWith([task], setupStatus);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  view.unmount(); await act(async () => second.reject(new Error("late failure")));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(base.onError).not.toHaveBeenCalled(); expect(mocks.list).toHaveBeenCalledTimes(2);
});
