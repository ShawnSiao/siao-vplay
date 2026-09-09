import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { LocalResourceStatus } from "../../types";
import { useCapabilityPreparation } from "./useCapabilityPreparation";

const status = (ready = false): LocalResourceStatus => ({
  configured: true, selectedParent: null, resourceRoot: null, rootState: "ready",
  freeSpaceBytes: null, preferredProfile: "fast",
  capabilities: [{ id: "basic_media", title: "媒体", state: ready ? "ready" : "not_ready", requiredResourceIds: [], missingResourceIds: [] }],
});
function deferred() {
  let resolve!: (value: LocalResourceStatus) => void;
  const promise = new Promise<LocalResourceStatus>(finish => { resolve = finish; });
  return { promise, resolve };
}
function setup(refresh = vi.fn(async () => status())) {
  const notice = vi.fn();
  const view = renderHook(({ current }: { current: LocalResourceStatus }) => useCapabilityPreparation({
    isDesktopApp: true, localResourceStatus: current, refreshLocalResources: refresh, setToast: notice,
  }), { initialProps: { current: status() } });
  return { ...view, notice };
}

it("does not reopen or resume a request dismissed while its status refresh was pending", async () => {
  const request = deferred();
  const resume = vi.fn();
  const { result } = setup(vi.fn(() => request.promise));
  let pending!: Promise<void>;
  act(() => { pending = result.current.requestCapability("basic_media", "旧操作", resume); });
  act(() => result.current.closeLocalResources());
  await act(async () => { request.resolve(status()); await pending; });
  expect(result.current.localResourcesOpen).toBe(false);
  expect(result.current.pendingResourceAction).toBeNull();
  expect(resume).not.toHaveBeenCalled();
});

it("does not let an older refresh replace the newest pending intent", async () => {
  const first = deferred(); const second = deferred();
  const refresh = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = setup(refresh);
  let older!: Promise<void>; let newer!: Promise<void>;
  act(() => { older = result.current.requestCapability("basic_media", "旧操作", vi.fn()); });
  act(() => { newer = result.current.requestCapability("basic_media", "新操作", vi.fn()); });
  await act(async () => { second.resolve(status()); await newer; });
  await act(async () => { first.resolve(status()); await older; });
  expect(result.current.pendingResourceAction?.label).toBe("新操作");
});

it("resumes a prepared intent exactly once and keeps close independent of downloads", async () => {
  const resume = vi.fn(); const { result, rerender } = setup();
  await act(async () => result.current.requestCapability("basic_media", "打开", resume, "fast"));
  expect(result.current.pendingResourceAction?.profileId).toBe("fast");
  rerender({ current: status(true) });
  await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  rerender({ current: status(true) });
  expect(result.current.localResourcesOpen).toBe(false);
  expect(result.current.pendingResourceAction).toBeNull();
  expect(resume).toHaveBeenCalledTimes(1);
});

it("does not invoke a late ready response after unmount", async () => {
  const request = deferred(); const resume = vi.fn();
  const { result, unmount } = setup(vi.fn(() => request.promise));
  let pending!: Promise<void>;
  act(() => { pending = result.current.requestCapability("basic_media", "打开", resume); });
  unmount();
  await act(async () => { request.resolve(status(true)); await pending; });
  expect(resume).not.toHaveBeenCalled();
});

it("contains a synchronous failure from the resumed action", async () => {
  const { result, rerender, notice } = setup();
  await act(async () => result.current.requestCapability("basic_media", "打开", () => { throw new Error("isolated failure"); }));
  rerender({ current: status(true) });
  await waitFor(() => expect(notice).toHaveBeenCalledTimes(2));
  expect(result.current.pendingResourceAction).toBeNull();
  expect(result.current.localResourcesOpen).toBe(false);
});

it("checks opening identity again when resources become ready", async () => {
  let current = true; const resume = vi.fn();
  const { result, rerender } = setup();
  await act(async () => result.current.requestCapability("basic_media", "旧视频", resume, undefined, () => current));
  current = false;
  rerender({ current: status(true) });
  await waitFor(() => expect(result.current.pendingResourceAction).toBeNull());
  expect(resume).not.toHaveBeenCalled();
});

it("opening general settings discards an outstanding capability refresh", async () => {
  const pending = deferred();
  const refresh = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(status());
  const { result } = setup(refresh);
  let operation!: Promise<void>;
  act(() => { operation = result.current.requestCapability("basic_media", "旧操作", vi.fn()); });
  act(() => result.current.openLocalResources());
  await act(async () => { pending.resolve(status()); await operation; });
  expect(result.current.localResourcesOpen).toBe(true);
  expect(result.current.pendingResourceAction).toBeNull();
});
