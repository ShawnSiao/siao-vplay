import { beforeEach, expect, it, vi } from "vitest";
import { clearPlaybackCache } from "./gateway";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => { mocks.invoke.mockReset(); });

it.each([null, {}, false, { reclaimedBytes: "10" }, { reclaimedBytes: -1 },
  { reclaimedBytes: 0.5 }, { reclaimedBytes: Infinity }, { reclaimedBytes: NaN },
  { reclaimedBytes: Number.MAX_SAFE_INTEGER + 1 }])("rejects an unconfirmed cache result %j", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(clearPlaybackCache()).rejects.toThrow("清理结果尚未确认");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it.each([0, 1024, Number.MAX_SAFE_INTEGER])("accepts reclaimed byte count %s", async reclaimedBytes => {
  mocks.invoke.mockResolvedValue({ reclaimedBytes });
  await expect(clearPlaybackCache()).resolves.toEqual({ reclaimedBytes });
  expect(mocks.invoke).toHaveBeenCalledWith("clear_playback_cache", { input: { confirmed: true } });
});

it("preserves backend failure without retrying a maintenance operation", async () => {
  const error = new Error("迁移正在进行");
  mocks.invoke.mockRejectedValue(error);
  await expect(clearPlaybackCache()).rejects.toBe(error);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
