import { beforeEach, expect, it, vi } from "vitest";
import { getNetworkSettings, setNetworkSettings } from "./gateway";
import schema from "../../../contracts/network-settings.schema.json";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
beforeEach(() => { mocks.invoke.mockReset(); });
const valid = { schemaVersion: 1, revision: 0, customProxyUrl: null, effectiveMode: "direct", effectiveSource: "direct", effectiveProxyAddress: null };

it.each(schema.examples)("accepts actual Rust network serialization %j", async (payload) => {
  mocks.invoke.mockResolvedValue(payload);
  expect(await getNetworkSettings()).toEqual(payload);
});

it("retains the largest exactly representable revision", async () => {
  const payload = { ...valid, revision: Number.MAX_SAFE_INTEGER };
  mocks.invoke.mockResolvedValue(payload);
  expect((await getNetworkSettings()).revision).toBe(Number.MAX_SAFE_INTEGER);
});

it.each([
  { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
  { ...valid, revision: -1 },
  { ...valid, schemaVersion: 1.5 },
  { ...valid, customProxyUrl: 42 },
  { ...valid, effectiveProxyAddress: undefined },
])("rejects malformed network settings on reads and saves %j", async (payload) => {
  mocks.invoke.mockResolvedValue(payload);
  await expect(getNetworkSettings()).rejects.toThrow("网络设置格式无效");
  await expect(setNetworkSettings(0, null)).rejects.toThrow("网络设置格式无效");
});

it("retains explicit null proxy values and optimistic save identity", async () => {
  mocks.invoke.mockResolvedValue(valid);
  expect(await getNetworkSettings()).toEqual(valid);
  expect(await setNetworkSettings(7, null)).toEqual(valid);
  expect(mocks.invoke).toHaveBeenLastCalledWith("set_network_settings", { input: { expectedRevision: 7, customProxyUrl: null } });
});
