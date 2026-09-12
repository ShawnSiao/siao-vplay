import { beforeEach, expect, it, vi } from "vitest";
import schema from "../../contracts/subtitle-version.schema.json";
import { getSubtitleVersion, listSubtitleVersions, reviseSubtitleVersion, restoreSubtitleVersion, importSubtitleFile, importEmbeddedSubtitle } from "./subtitleGateway";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const body = schema.examples[0];
beforeEach(() => { invoke.mockReset(); });
it.each([
  { role: "unknown" }, { status: "unknown" }, { sourceKind: "unknown" }, { projectRevision: Number.MAX_SAFE_INTEGER + 1 },
  { segments: [{ ...body.segments[0], words: null }] }, { segments: [{ ...body.segments[0], startMs: "now" }] },
  { segments: [{ ...body.segments[0], issueKind: "unsupported" }] },
  { segments: [{ ...body.segments[0], confidence: 2 }] },
  { preflight: { ...body.preflight, status: "unknown" } },
  { preflight: { ...body.preflight, issues: [{ code: "unknown", severity: "warning", ordinal: null, relatedOrdinal: null, message: "test" }] } },
  { id: "other-version" }, { projectId: "other-project" }, { parentVersionId: undefined },
])("rejects malformed or unrelated subtitle bodies %j", async patch => {
  invoke.mockResolvedValue({ ...body, ...patch });
  await expect(getSubtitleVersion("p", "v")).rejects.toThrow();
});
it("checks project association at every body-producing mutation", async () => {
  invoke.mockResolvedValue({ ...body, projectId: "other" });
  const preview = { sourceSha256: "a".repeat(64), expectedMediaSha256: "b".repeat(64), expectedProjectRevision: 1 };
  await expect(reviseSubtitleVersion("p", "base", 1)).rejects.toThrow();
  await expect(restoreSubtitleVersion("p", "current", "old", 1)).rejects.toThrow();
  await expect(importSubtitleFile("p", "fixture.srt", "en", preview)).rejects.toThrow();
  await expect(importEmbeddedSubtitle("p", 1, "en", preview)).rejects.toThrow();
});
it("rejects malformed lists, unrelated versions and duplicate identities", async () => {
  for (const value of [null, {}, [body, body], [{ ...body, projectId: "other" }]]) {
    invoke.mockResolvedValue(value);
    await expect(listSubtitleVersions("p", false)).rejects.toThrow();
  }
});
it("keeps current-only reads explicit and accepts the real Rust wire example", async () => {
  invoke.mockResolvedValue(body);
  await expect(getSubtitleVersion("p", "v")).resolves.toEqual(body);
  invoke.mockResolvedValue([body]);
  await expect(listSubtitleVersions("p", false)).resolves.toEqual([body]);
  expect(invoke).toHaveBeenLastCalledWith("list_subtitle_versions", { projectId: "p", includeHistory: false });
});

it("rejects duplicate subtitle segment identities", async () => {
  invoke.mockResolvedValue({ ...body, segments: [body.segments[0], body.segments[0]] });
  await expect(getSubtitleVersion("p", "v")).rejects.toThrow();
});
it.each(schema.examples)("accepts Rust serialization across role/status/source combinations %#", async wire => {
  invoke.mockResolvedValue(wire);
  await expect(getSubtitleVersion("p", "v")).resolves.toEqual(wire);
});

it("retains usable overlapping subtitles with explicit preflight warnings", async () => {
  const value = { ...body, segments: [body.segments[0], { ...body.segments[0], id: "second", lineageId: "second", ordinal: 1, startMs: 500, endMs: 1500, words: [] }],
    preflight: { ...body.preflight, status: "warning", warningCount: 1, segmentCount: 2, lastEndMs: 1500, coverageRatio: 1,
      issues: [{ code: "overlap", severity: "warning", ordinal: 1, relatedOrdinal: 0, message: "时间重叠" }] } };
  invoke.mockResolvedValue(value);
  await expect(getSubtitleVersion("p", "v")).resolves.toEqual(value);
});
it("validates nested word confidence and timestamps", async () => {
  for (const patch of [{ confidence: 2 }, { startMs: Number.MAX_SAFE_INTEGER + 1 }, { endMs: "later" }]) {
    invoke.mockResolvedValue({ ...body, segments: [{ ...body.segments[0], words: [{ ...body.segments[0].words[0], ...patch }] }] });
    await expect(getSubtitleVersion("p", "v")).rejects.toThrow();
  }
});
