import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
import { inspectSubtitleFile, inspectEmbeddedSubtitle } from "./subtitleGateway";
const preview = {
  format: "srt", sourceLabel: "captions.srt", sourceSha256: "a".repeat(64), languageCode: "en-us",
  expectedProjectRevision: 1, expectedMediaSha256: "b".repeat(64), cues: [], canImport: false,
  preflight: { status: "blocked", segmentCount: 0, errorCount: 1, warningCount: 0, firstStartMs: null,
    lastEndMs: null, mediaDurationMs: null, coverageRatio: null,
    issues: [{ code: "empty_text", severity: "error", ordinal: null, relatedOrdinal: null, message: "无字幕" }] },
};
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([{}, { ...preview, languageCode: "ja" }, { ...preview, expectedProjectRevision: -1 },
  { ...preview, sourceSha256: "" }, { ...preview, canImport: true },
  { ...preview, preflight: { ...preview.preflight, segmentCount: 2 } }]
  .map(value => ({ value })))("rejects invalid file preview", async ({ value }) => {
  mocks.invoke.mockResolvedValue(value);
  await expect(inspectSubtitleFile("p", "W:/captions.srt", " EN_US ")).rejects.toThrow();
});
it("retains blocked preview for user inspection and normalizes requested language", async () => {
  mocks.invoke.mockResolvedValue(preview);
  await expect(inspectSubtitleFile("p", "W:/captions.srt", " EN_US ")).resolves.toEqual(preview);
});
it("rejects a different embedded stream", async () => {
  mocks.invoke.mockResolvedValue({ ...preview, streamIndex: 3, codecName: "subrip", embeddedLanguage: null });
  await expect(inspectEmbeddedSubtitle("p", 2, "en-us")).rejects.toThrow();
});
it("preserves matching embedded preview", async () => {
  const embedded = { ...preview, streamIndex: 2, codecName: "subrip", embeddedLanguage: null };
  mocks.invoke.mockResolvedValue(embedded);
  await expect(inspectEmbeddedSubtitle("p", 2, "en-us")).resolves.toEqual(embedded);
});
it("retains invalid cue timing so the preflight error can be displayed", async () => {
  const blocked = { ...preview,
    cues: [{ ordinal: 0, startMs: -10, endMs: -20, text: "字幕", confidence: null }],
    preflight: { ...preview.preflight, segmentCount: 1,
      issues: [{ code: "invalid_timing", severity: "error", ordinal: 0, relatedOrdinal: null, message: "时间无效" }] },
  };
  mocks.invoke.mockResolvedValue(blocked);
  await expect(inspectSubtitleFile("p", "W:/captions.srt", "en-us")).resolves.toEqual(blocked);
});
it("preserves importable previews", async () => {
  const ready = { ...preview, canImport: true,
    cues: [{ ordinal: 0, startMs: 0, endMs: 1000, text: "字幕", confidence: null }],
    preflight: { ...preview.preflight, status: "ready", segmentCount: 1, errorCount: 0, issues: [] },
  };
  mocks.invoke.mockResolvedValue(ready);
  await expect(inspectSubtitleFile("p", "W:/captions.srt", "en-us")).resolves.toEqual(ready);
});
