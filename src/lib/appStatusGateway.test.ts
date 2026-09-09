import { afterAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => { Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} }); return { invoke: vi.fn() }; });
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { getAppStatus } from "./desktop";
const status = { appName: "SiaoVPlay", version: "0.4.1", platform: "windows-desktop", dataDirectory: "W:/data", startupMediaPath: null };
beforeEach(() => mocks.invoke.mockReset());
afterAll(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });
it.each([{ appName: "SiaoVPlay" }, { ...status, dataDirectory: null }, { ...status, dataDirectory: " " }, { ...status, version: "" }, { ...status, platform: "unknown" }, { ...status, startupMediaPath: 4 }])("rejects invalid application startup status", async value => {
  mocks.invoke.mockResolvedValue(value); await expect(getAppStatus()).rejects.toThrow();
});
it("retains an explicit startup media path and recovers after a bad read", async () => {
  mocks.invoke.mockResolvedValueOnce({}).mockResolvedValue({ ...status, startupMediaPath: "F:/video.mp4" });
  await expect(getAppStatus()).rejects.toThrow();
  await expect(getAppStatus()).resolves.toEqual({ ...status, startupMediaPath: "F:/video.mp4" });
});
