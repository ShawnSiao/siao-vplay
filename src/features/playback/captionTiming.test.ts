import { describe, expect, it } from "vitest";
import type { SubtitleSegment } from "../../types";
import { getTimedCaptionWords, hasUsableWordTiming } from "./captionTiming";

function segment(overrides: Partial<SubtitleSegment> = {}): SubtitleSegment {
  return {
    id: "segment-1",
    lineageId: "lineage-1",
    sourceSegmentId: null,
    issueKind: null,
    ordinal: 0,
    startMs: 1_000,
    endMs: 3_000,
    text: "And this",
    confidence: 0.9,
    words: [
      { ordinal: 0, startMs: 1_000, endMs: 1_500, text: "And", confidence: 0.9 },
      { ordinal: 1, startMs: 1_700, endMs: 2_200, text: " this", confidence: 0.9 },
    ],
    ...overrides,
  };
}

describe("caption word timing", () => {
  it("reports spoken, current and future words with partial progress", () => {
    expect(getTimedCaptionWords(segment(), 1_250)).toMatchObject([
      { state: "current", progress: 0.5 },
      { state: "future", progress: 0 },
    ]);
    expect(getTimedCaptionWords(segment(), 1_600)).toMatchObject([
      { state: "spoken", progress: 1 },
      { state: "future", progress: 0 },
    ]);
  });

  it.each([
    segment({ words: [] }),
    segment({ words: [{ ordinal: 0, startMs: 900, endMs: 1_500, text: "And this", confidence: null }] }),
    segment({ words: [{ ordinal: 0, startMs: 1_000, endMs: 1_500, text: "different", confidence: null }] }),
    segment({ words: [{ ordinal: 0, startMs: 2_000, endMs: 1_500, text: "And this", confidence: null }] }),
    segment({ words: [
      { ordinal: 0, startMs: 1_000, endMs: 1_800, text: "And", confidence: null },
      { ordinal: 1, startMs: 1_700, endMs: 2_200, text: " this", confidence: null },
    ] }),
  ])("rejects incomplete or inconsistent timing", (value) => {
    expect(hasUsableWordTiming(value)).toBe(false);
    expect(getTimedCaptionWords(value, 1_250)).toBeNull();
  });

  it.each([
    ["泰语", ["泰", "语"]],
    ["日本語", ["日本", "語"]],
    ["한국어", ["한국", "어"]],
  ])("preserves scripts that do not use spaces", (text, parts) => {
    const value = segment({
      text,
      words: parts.map((part, ordinal) => ({
        ordinal,
        startMs: 1_000 + ordinal * 500,
        endMs: 1_400 + ordinal * 500,
        text: part,
        confidence: null,
      })),
    });
    expect(hasUsableWordTiming(value)).toBe(true);
    expect(getTimedCaptionWords(value, 1_100)?.map((word) => word.text).join(""))
      .toBe(text);
  });
});
