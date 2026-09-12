import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { getCodexRuntimeStatus } from "./desktop";
const ready = { available: true, supported: true, authenticated: true, version: "codex-cli 0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null };
beforeEach(() => mocks.invoke.mockReset());
it.each([{}, { available: "yes" }, { supported: false }, { authenticated: false }, { authMode: null }, { version: null }, { minimumVersion: "" }, { errorCode: "failure", errorMessage: "failed" }])("rejects incomplete or contradictory readiness %j", async patch => {
  mocks.invoke.mockResolvedValue(Object.keys(patch).length ? { ...ready, ...patch } : { available: true });
  await expect(getCodexRuntimeStatus()).rejects.toThrow();
});
it("retains a valid unavailable diagnosis", async () => {
  const unavailable = { ...ready, available: false, authenticated: false, supported: false, version: null, authMode: null, errorCode: "codex_runtime_unavailable", errorMessage: "未找到 Codex" };
  mocks.invoke.mockResolvedValue(unavailable);
  await expect(getCodexRuntimeStatus()).resolves.toEqual(unavailable);
});
it("accepts ready status and can recover after a bad response", async () => {
  mocks.invoke.mockResolvedValueOnce({ available: true }).mockResolvedValue(ready);
  await expect(getCodexRuntimeStatus()).rejects.toThrow();
  await expect(getCodexRuntimeStatus()).resolves.toEqual(ready);
});
