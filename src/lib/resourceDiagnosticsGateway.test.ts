import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { getLocalResourceDiagnostics } from "./desktop";
beforeEach(() => mocks.invoke.mockReset());
const version = { version: "1", active: true, installPath: "W:\\resources", fileCount: 1,
  installedBytes: 12, manifestSha256: "a".repeat(64), healthStatus: "ready", activatedAtMs: null, entrypointsAvailable: true };
const resource = { id: "ffmpeg", catalogVersion: "1", activeVersion: "1", state: "ready", license: "LGPL",
  sourcePage: "https://example.test", artifactSha256: null, artifactUrl: null, healthCheck: "version", versions: [version] };
const sample = { generatedAtMs: 1, catalogSource: "embedded", remoteCatalogEnabled: false,
  remoteSignaturePolicy: "required", rootState: "ready", resourceRoot: "W:\\resources",
  preferredProfile: "standard", resources: [resource], tasks: [] };
it.each([
  null,
  { ...sample, resources: null },
  { ...sample, generatedAtMs: Number.MAX_SAFE_INTEGER + 1 },
  { ...sample, rootState: "unknown" },
  { ...sample, resources: [resource, resource] },
  { ...sample, resources: [{ ...resource, state: "unknown" }] },
  { ...sample, resources: [{ ...resource, versions: [version, version] }] },
  { ...sample, resources: [{ ...resource, versions: [{ ...version, installedBytes: -1 }] }] },
  { ...sample, resources: [{ ...resource, versions: [{ ...version, active: false }] }] },
  { ...sample, tasks: [{ id: "task", resourceId: "ffmpeg", version: "1", state: "failed",
    downloadedBytes: 0, totalBytes: 0, errorCode: null }] },
])("rejects malformed or contradictory diagnostics %#", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getLocalResourceDiagnostics()).rejects.toThrow();
});
it("accepts a valid diagnostic snapshot and keeps the command read-only", async () => {
  mocks.invoke.mockResolvedValue(sample);
  await expect(getLocalResourceDiagnostics()).resolves.toEqual(sample);
  expect(mocks.invoke).toHaveBeenCalledWith("get_local_resource_diagnostics");
});
it("accepts repair-required snapshots whose active receipt is unavailable", async () => {
  const value = { ...sample, resources: [{ ...resource, state: "repair_required", versions: [] }] };
  mocks.invoke.mockResolvedValue(value);
  await expect(getLocalResourceDiagnostics()).resolves.toEqual(value);
});
