import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createResourceTaskFixture } from "../../test-fixtures/resourceTask";
import { useLocalResources } from "./useLocalResources";
const mocks = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => {
  vi.useFakeTimers(); mocks.listen.mockReset(); mocks.invoke.mockReset();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
});
afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });
it("reports invalid events and accepts a later valid event through the real gateway", async () => {
  const stop = vi.fn(); mocks.listen.mockResolvedValue(stop);
  const { result, unmount } = renderHook(() => useLocalResources());
  await act(async () => {});
  const receive = mocks.listen.mock.calls[0][1];
  await act(async () => receive({ payload: { id: "invalid" } }));
  expect(result.current.error).toContain("资源任务格式无效"); expect(result.current.tasks).toEqual([]);
  const task = { ...createResourceTaskFixture(), state: "paused" as const };
  await act(async () => receive({ payload: task }));
  expect(result.current.tasks).toEqual([task]);
  unmount(); expect(stop).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("unsubscribes a late registration after unmount", async () => {
  let finish!: (stop: () => void) => void;
  mocks.listen.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { unmount } = renderHook(() => useLocalResources()); unmount();
  const stop = vi.fn(); await act(async () => finish(stop)); expect(stop).toHaveBeenCalledTimes(1);
});
