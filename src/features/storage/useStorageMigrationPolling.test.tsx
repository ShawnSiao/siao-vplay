import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStorageSettings } from "./useStorageSettings";
import { storageSettingsFixture as settings, storageMigrationFixture } from "../../test-fixtures/storage";
const task = { ...storageMigrationFixture, status: "running" as const };
const gateway = vi.hoisted(() => ({ getStorageSettings: vi.fn(), getCurrentStorageMigration: vi.fn(), getStorageMigration: vi.fn(), cancelStorageMigration: vi.fn() }));
vi.mock("./gateway", () => gateway);
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); gateway.getStorageSettings.mockResolvedValue(settings); gateway.getCurrentStorageMigration.mockResolvedValue(task); });
afterEach(() => { vi.useRealTimers(); });
async function controller() {
  const notice = vi.fn();
  const hook = renderHook(() => useStorageSettings(true, false, notice));
  await act(() => vi.advanceTimersByTimeAsync(0));
  return hook;
}
it("does not overlap migration reads when one takes longer than its polling interval", async () => {
  gateway.getStorageMigration.mockReturnValue(new Promise(() => {}));
  await controller();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(gateway.getStorageMigration).toHaveBeenCalledTimes(1);
});
it("does not replace cancelled state with an already-started running read", async () => {
  let finish!: (value: typeof task) => void;
  gateway.getStorageMigration.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  gateway.cancelStorageMigration.mockResolvedValue({ ...task, status: "cancelled" });
  const { result } = await controller();
  await act(() => vi.advanceTimersByTimeAsync(500));
  await act(async () => { await result.current.cancel(); finish(task); });
  expect(result.current.migration?.status).toBe("cancelled");
});
it.each([{ id: "other" }, { destinationRoot: "W:/wrong" }, { area: "app_data" }])("rejects a poll belonging to different migration context", async patch => {
  gateway.getStorageMigration.mockResolvedValue({ ...task, ...patch });
  const { result } = await controller();
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(result.current.migration).toEqual(task);
  expect(result.current.error).toContain("迁移");
});

it("continues polling after a failed read", async () => {
  gateway.getStorageMigration.mockRejectedValueOnce(new Error("读取失败")).mockResolvedValue({ ...task, status: "completed" });
  const { result } = await controller();
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(result.current.error).toContain("读取失败");
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(result.current.migration?.status).toBe("completed");
  expect(gateway.getStorageMigration).toHaveBeenCalledTimes(2);
});

it("keeps cancellation pending until the worker reports a terminal state", async () => {
  gateway.cancelStorageMigration.mockResolvedValue(task);
  gateway.getStorageMigration.mockResolvedValue({ ...task, status: "cancelled" });
  const { result } = await controller();
  await act(() => result.current.cancel());
  expect(result.current.operation).toBe("cancelling");
  await act(() => result.current.cancel());
  expect(gateway.cancelStorageMigration).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(result.current.migration?.status).toBe("cancelled");
  expect(result.current.operation).toBeNull();
});
it("does not let a late cancel acknowledgement overwrite a completed task", async () => {
  let finish!: (value: typeof task) => void;
  gateway.cancelStorageMigration.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  gateway.getStorageMigration.mockResolvedValue({ ...task, status: "completed" });
  const { result } = await controller();
  let cancellation!: Promise<void>;
  act(() => { cancellation = result.current.cancel(); });
  await act(() => vi.advanceTimersByTimeAsync(500));
  await act(async () => { finish(task); await cancellation; });
  expect(result.current.migration?.status).toBe("completed");
});

it("allows another cancellation attempt after a failed request", async () => {
  gateway.cancelStorageMigration.mockRejectedValueOnce(new Error("取消请求失败")).mockResolvedValue(task);
  const { result } = await controller();
  await act(() => result.current.cancel());
  expect(result.current.error).toContain("取消请求失败");
  expect(result.current.operation).toBeNull();
  await act(() => result.current.cancel());
  expect(result.current.operation).toBe("cancelling");
  expect(gateway.cancelStorageMigration).toHaveBeenCalledTimes(2);
});
it("ignores a cancellation acknowledgement after switching migration tasks", async () => {
  let finish!: (value: typeof task) => void;
  gateway.cancelStorageMigration.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { result } = await controller();
  let cancellation!: Promise<void>;
  act(() => { cancellation = result.current.cancel(); });
  gateway.getCurrentStorageMigration.mockResolvedValue({ ...task, id: "another" });
  await act(() => result.current.reload());
  await act(async () => { finish(task); await cancellation; });
  expect(result.current.migration?.id).toBe("another");
  expect(result.current.operation).toBeNull();
});
