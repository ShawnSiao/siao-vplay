import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { setupStatus } from "../test-fixtures/localResources";
const mocks = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  return { invoke: vi.fn() };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { getLocalResourceStatus, configureLocalResourceRoot, repairLocalResourceRoot, reconnectLocalResourceRoot, setLocalResourceProfile, getLocalResourceNetworkStatus, setLocalResourceProxy } from "./desktop";
afterAll(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([
  () => getLocalResourceStatus(), () => configureLocalResourceRoot("W:\\fixture", true),
  () => repairLocalResourceRoot(), () => reconnectLocalResourceRoot("W:\\fixture"), () => setLocalResourceProfile("standard"),
])("rejects invalid status from every status-producing command", async read => {
  mocks.invoke.mockResolvedValue({ ...setupStatus, rootState: "invented" }); await expect(read()).rejects.toThrow();
});
it.each([
  { freeSpaceBytes: Number.MAX_SAFE_INTEGER + 1 },
  { capabilities: [setupStatus.capabilities[0], setupStatus.capabilities[0]] },
  { capabilities: [{ ...setupStatus.capabilities[0], missingResourceIds: ["outside"] }] },
])("rejects invalid resource status data %j", async patch => {
  mocks.invoke.mockResolvedValue({ ...setupStatus, ...patch }); await expect(getLocalResourceStatus()).rejects.toThrow();
});
it("rejects a different selected profile", async () => {
  mocks.invoke.mockResolvedValue(setupStatus); await expect(setLocalResourceProfile("fast")).rejects.toThrow();
});
it.each([getLocalResourceNetworkStatus, () => setLocalResourceProxy(null)])("rejects unknown network sources", async read => {
  mocks.invoke.mockResolvedValue({ mode: "proxy", proxySource: "invented", proxyAddress: null }); await expect(read()).rejects.toThrow();
});
it("rejects contradictory direct/proxy state", async () => {
  mocks.invoke.mockResolvedValue({ mode: "direct", proxySource: "custom", proxyAddress: "http://127.0.0.1:8080" });
  await expect(getLocalResourceNetworkStatus()).rejects.toThrow();
});

it.each(["setup_required", "ready", "root_unavailable", "repair_required"] as const)("accepts emitted root state %s", async rootState => {
  const value = { ...setupStatus, rootState }; mocks.invoke.mockResolvedValue(value);
  await expect(getLocalResourceStatus()).resolves.toEqual(value);
});
it.each(["setup_required", "not_ready", "preparing", "ready", "repair_required", "root_unavailable", "update_available"] as const)("accepts capability state %s", async state => {
  const value = { ...setupStatus, capabilities: [{ ...setupStatus.capabilities[0], state, missingResourceIds: state === "ready" ? [] : ["ffmpeg-cpu"] }] };
  mocks.invoke.mockResolvedValue(value); await expect(getLocalResourceStatus()).resolves.toEqual(value);
});
it.each([
  { mode: "direct", proxySource: "direct", proxyAddress: null },
  { mode: "proxy", proxySource: "environment", proxyAddress: null },
  { mode: "proxy", proxySource: "windows_system", proxyAddress: "http://127.0.0.1:8080" },
  { mode: "proxy", proxySource: "custom", proxyAddress: "http://127.0.0.1:8080" },
])("accepts network source $proxySource", async value => {
  mocks.invoke.mockResolvedValue(value); await expect(getLocalResourceNetworkStatus()).resolves.toEqual(value);
});
it("passes configuration confirmation and validates the selected profile", async () => {
  mocks.invoke.mockResolvedValue(setupStatus);
  await configureLocalResourceRoot("W:\\fixture", true);
  expect(mocks.invoke).toHaveBeenCalledWith("configure_local_resource_root", { input: { parentPath: "W:\\fixture", confirmed: true } });
  mocks.invoke.mockResolvedValue({ ...setupStatus, preferredProfile: "fast" });
  await expect(setLocalResourceProfile("fast")).resolves.toHaveProperty("preferredProfile", "fast");
});

it.each([undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid status sequence %s", async snapshotRevision => {
  mocks.invoke.mockResolvedValue({ ...setupStatus, snapshotRevision });
  await expect(getLocalResourceStatus()).rejects.toThrow();
});
