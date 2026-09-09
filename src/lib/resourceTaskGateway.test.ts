import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createResourceTaskFixture } from "../test-fixtures/resourceTask";
import { listResourceDownloadTasks, prepareLocalCapability, pauseResourceDownload, resumeResourceDownload, cancelResourceDownload, retryResourceDownload, repairLocalResource, updateLocalResource, listenResourceDownloadTasks } from "./desktop";
const mocks = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  return { invoke: vi.fn(), listen: vi.fn() };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
afterAll(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });
beforeEach(() => { mocks.invoke.mockReset(); mocks.listen.mockReset(); });
const task = createResourceTaskFixture();
it.each([pauseResourceDownload, resumeResourceDownload, cancelResourceDownload, retryResourceDownload])("rejects the wrong task from a lifecycle command", async action => {
  mocks.invoke.mockResolvedValue({ ...task, id: "other" }); await expect(action(task.id)).rejects.toThrow();
});
it.each([repairLocalResource, updateLocalResource])("rejects the wrong resource after maintenance", async action => {
  mocks.invoke.mockResolvedValue({ ...task, resourceId: "other" }); await expect(action(task.resourceId)).rejects.toThrow();
});
it.each([{ state: "unknown" }, { downloadedBytes: -1 }, { totalBytes: Number.MAX_SAFE_INTEGER + 1 }, { pendingActionIds: null }, { forceReinstall: null }])("rejects malformed task lists %j", async patch => {
  mocks.invoke.mockResolvedValue([{ ...task, ...patch }]); await expect(listResourceDownloadTasks()).rejects.toThrow();
});
it("rejects duplicate tasks", async () => {
  mocks.invoke.mockResolvedValue([task, task]); await expect(listResourceDownloadTasks()).rejects.toThrow();
});
it.each([{ capabilityId: "other" }, { pendingActionId: "other" }, { state: "unknown" }, { readyResourceIds: ["outside"] }])("rejects a mismatched capability response %j", async patch => {
  mocks.invoke.mockResolvedValue({ capabilityId: "capability", pendingActionId: null, state: "preparing", resourceIds: ["resource"], readyResourceIds: [], taskIds: ["task"], ...patch });
  await expect(prepareLocalCapability("capability")).rejects.toThrow();
});
it("does not deliver a malformed event to consumers", async () => {
  const consumer = vi.fn(); const onError = vi.fn();
  await listenResourceDownloadTasks(consumer, onError);
  const callback = mocks.listen.mock.calls[0][1];
  expect(() => callback({ payload: { ...task, state: "unknown" } })).not.toThrow();
  expect(consumer).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledTimes(1);
});

it.each(["queued", "downloading", "paused", "verifying", "installing", "completed", "failed", "cancelled"] as const)("accepts emitted task state %s", async state => {
  const value = { ...task, state, downloadedBytes: 200, totalBytes: 100 };
  mocks.invoke.mockResolvedValue([value]); await expect(listResourceDownloadTasks()).resolves.toEqual([value]);
});
it.each(["ready", "preparing"])("accepts matching preparation state %s and intent", async state => {
  const pendingActionId = "e27d7d81-d498-46f5-926d-ccf01df4be67";
  const value = { capabilityId: "capability", pendingActionId, state, resourceIds: ["resource"], readyResourceIds: state === "ready" ? ["resource"] : [], taskIds: state === "ready" ? [] : ["task"] };
  mocks.invoke.mockResolvedValue(value); await expect(prepareLocalCapability("capability", pendingActionId)).resolves.toEqual(value);
  expect(mocks.invoke).toHaveBeenCalledWith("prepare_local_capability", { input: { capabilityId: "capability", pendingActionId } });
});
it("continues delivering valid events after a rejected payload and returns unsubscribe", async () => {
  const consumer = vi.fn(); const onError = vi.fn(); const stop = vi.fn(); mocks.listen.mockResolvedValue(stop);
  expect(await listenResourceDownloadTasks(consumer, onError)).toBe(stop);
  const callback = mocks.listen.mock.calls[0][1]; callback({ payload: null }); callback({ payload: task });
  expect(onError).toHaveBeenCalledTimes(1); expect(consumer).toHaveBeenCalledExactlyOnceWith(task);
});
it("preserves the browser preview without requesting native services", async () => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  try {
    await expect(listResourceDownloadTasks()).resolves.toEqual([]);
    const stop = await listenResourceDownloadTasks(vi.fn(), vi.fn()); stop();
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.listen).not.toHaveBeenCalled();
  } finally { Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} }); }
});
it.each([
  { state: "ready", readyResourceIds: [], taskIds: [] },
  { state: "ready", readyResourceIds: ["resource"], taskIds: ["task"] },
  { state: "preparing", readyResourceIds: [], taskIds: [] },
  { state: "preparing", readyResourceIds: [], taskIds: ["task", "task"] },
])("rejects inconsistent readiness %j", async patch => {
  mocks.invoke.mockResolvedValue({ capabilityId: "capability", pendingActionId: null, resourceIds: ["resource"], ...patch });
  await expect(prepareLocalCapability("capability")).rejects.toThrow();
});
