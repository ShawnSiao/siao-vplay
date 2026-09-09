import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
import { prepareProjectMedia } from "./desktop";
const valid = {
  inspection: {
    projectId: "project", mediaSourceId: "source", sourceSha256: "a".repeat(64),
    probe: { containerFormats: ["mp4"], durationMs: 1000, sizeBytes: 128, bitRate: null, videoStreams: [], audioStreams: [], subtitleStreams: [] },
    playbackGate: { decision: "direct", reasonCodes: [], requiresRuntimeVideoCheck: false },
    ffmpegVersion: "test", reusedProbe: true,
  },
  playbackSourceKind: "original", playbackPath: "W:/fixture/video.mp4", proxyArtifact: null, reusedProxy: false,
};
beforeEach(() => mocks.invoke.mockReset());
it.each([
  {},
  { ...valid, inspection: { ...valid.inspection, projectId: "other" } },
  { ...valid, playbackPath: " " },
  { ...valid, playbackSourceKind: "unknown" },
  { ...valid, playbackSourceKind: "proxy" },
  { ...valid, inspection: { ...valid.inspection, probe: { ...valid.inspection.probe, durationMs: -1 } } },
])("rejects unusable or unrelated prepared media", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(prepareProjectMedia("project", false, "request")).rejects.toThrow();
});
it("preserves a valid original playback result", async () => {
  mocks.invoke.mockResolvedValue(valid);
  await expect(prepareProjectMedia("project", false, "request")).resolves.toEqual(valid);
});
const artifact = { id: "proxy", projectId: "project", sourceMediaId: "source", status: "completed", path: "W:/fixture/proxy.mp4", sourceSha256: "a".repeat(64), profile: "test", errorCode: null, errorMessage: null, createdAtMs: 1, updatedAtMs: 2 };
const proxy = { ...valid, playbackSourceKind: "proxy", playbackPath: artifact.path, proxyArtifact: artifact, reusedProxy: true };
it("accepts a completed proxy bound to the inspected source", async () => {
  mocks.invoke.mockResolvedValue(proxy);
  await expect(prepareProjectMedia("project", true)).resolves.toEqual(proxy);
});
it.each([
  { ...artifact, projectId: "other" }, { ...artifact, sourceMediaId: "other" },
  { ...artifact, sourceSha256: "b".repeat(64) }, { ...artifact, path: "W:/other.mp4" },
  { ...artifact, status: "running" },
])("rejects an unrelated or unfinished proxy", async proxyArtifact => {
  mocks.invoke.mockResolvedValue({ ...proxy, proxyArtifact });
  await expect(prepareProjectMedia("project", true)).rejects.toThrow();
});
