import { afterAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  return { invoke: vi.fn() };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { getLocalResourceCatalog } from "./desktop";
afterAll(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });
beforeEach(() => mocks.invoke.mockReset());
const resource = { id: "tool", version: "1", platform: "windows-x86_64", kind: "file", bundled: false,
  installedSize: 12, expectedDownloadSize: null, license: "MIT", sourcePage: "https://example.test",
  artifact: { url: "https://example.test/tool.exe", size: 10, sha256: "a".repeat(64), format: "file", stripComponents: null },
  entrypoints: { tool: "tool.exe" }, healthCheck: "version", sourceCommit: null, patchSha256: null, requires: null, distribution: null };
const sample = { schemaVersion: 1, productId: "siaovplay", updatedAt: "", packageProfile: "app-only",
  bundlePolicy: { maximumExceptionBytes: 20_000_000, allowlistedResourceIds: [] },
  resources: [resource], profiles: [{ id: "standard", title: "标准", resourceIds: ["tool"], recommended: true }],
  capabilities: [{ id: "play", title: "播放", resourceIds: ["tool"], profileIds: ["standard"], requiresCapabilityIds: [] }] };
it.each([
  null,
  { ...sample, schemaVersion: 2 },
  { ...sample, productId: "other" },
  { ...sample, resources: [resource, resource] },
  { ...sample, resources: [{ ...resource, installedSize: Number.MAX_SAFE_INTEGER + 1 }] },
  { ...sample, resources: [{ ...resource, bundled: true }] },
  { ...sample, resources: [{ ...resource, expectedDownloadSize: 11 }] },
  { ...sample, resources: [{ ...resource, artifact: null }] },
  { ...sample, profiles: [] },
  { ...sample, profiles: [{ ...sample.profiles[0], resourceIds: ["missing"] }] },
  { ...sample, capabilities: [{ ...sample.capabilities[0], profileIds: ["missing"] }] },
  { ...sample, capabilities: [{ ...sample.capabilities[0], requiresCapabilityIds: ["missing"] }] },
])("rejects malformed or inconsistent resource catalogue %#", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getLocalResourceCatalog()).rejects.toThrow();
});
it("accepts a complete catalogue without changing its version or references", async () => {
  mocks.invoke.mockResolvedValue(sample);
  await expect(getLocalResourceCatalog()).resolves.toEqual(sample);
  expect(mocks.invoke).toHaveBeenCalledWith("get_local_resource_catalog");
});
it("accepts a described resource awaiting a release asset", async () => {
  const value = { ...sample, resources: [{ ...resource, artifact: null, expectedDownloadSize: 10, distribution: { status: "pending_release_asset" } }] };
  mocks.invoke.mockResolvedValue(value);
  await expect(getLocalResourceCatalog()).resolves.toEqual(value);
});
