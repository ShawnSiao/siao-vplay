import { expect, it } from "vitest";
import { parseSubtitleMetadata } from "./subtitleMetadata";
const metadata = { id: "v", trackId: "t", projectId: "p", role: "original", versionNumber: 1,
  status: "ready", sourceLabel: "字幕", languageCode: "en", createdAtMs: 1, isCurrent: true, segmentCount: 75 };
it("accepts metadata without subtitle bodies", () => {
  expect(parseSubtitleMetadata([metadata])).toEqual([metadata]);
});
it.each([{ segmentCount: -1 }, { versionNumber: 0 }, { segmentCount: 1.5 }, { role: "unknown" },
  { status: "unknown" }, { role: ["original"] }, { status: ["ready"] }, { segments: [] }, { preflight: {} }, { sourceLabel: null }, { isCurrent: 1 }])("rejects invalid metadata %j", (change) => {
  expect(() => parseSubtitleMetadata([{ ...metadata, ...change }])).toThrow("字幕版本列表格式无效");
});
