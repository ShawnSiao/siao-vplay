import { describe, expect, it } from "vitest";
import type { SubtitleSegment } from "../../types";
import { getTimedCaptionFragments, getTimedCaptionWords, hasUsableWordTiming } from "./captionTiming";

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
  ])("rejects timing when no token can be aligned safely", (value) => {
    expect(hasUsableWordTiming(value)).toBe(false);
    expect(getTimedCaptionWords(value, 1_250)).toBeNull();
  });

  it("preserves the canonical sentence while following a reliable timed subset", () => {
    const value = segment({
      endMs: 6_000,
      text: "we're going to see what agent memory systems are. And then",
      words: [
        { ordinal: 0, startMs: 1_000, endMs: 1_300, text: "'re", confidence: null },
        { ordinal: 1, startMs: 1_300, endMs: 1_700, text: "going", confidence: null },
        { ordinal: 2, startMs: 1_700, endMs: 2_000, text: "see", confidence: null },
        { ordinal: 3, startMs: 2_000, endMs: 2_300, text: "agent", confidence: null },
        { ordinal: 4, startMs: 2_300, endMs: 2_700, text: "memory", confidence: null },
        { ordinal: 5, startMs: 2_700, endMs: 3_100, text: "systems", confidence: null },
        { ordinal: 6, startMs: 3_100, endMs: 3_400, text: "are", confidence: null },
        { ordinal: 7, startMs: 3_400, endMs: 3_500, text: ".", confidence: null },
        { ordinal: 8, startMs: 3_500, endMs: 3_800, text: "And", confidence: null },
        { ordinal: 9, startMs: 3_800, endMs: 4_100, text: "then", confidence: null },
      ],
    });
    const fragments = getTimedCaptionFragments(value, 1_500);
    expect(fragments?.map((fragment) => fragment.text).join("")).toBe(value.text);
    expect(fragments?.filter((fragment) => fragment.kind === "timed")).toHaveLength(9);
    expect(fragments?.find((fragment) => fragment.kind === "timed" && fragment.word.state === "current")?.text).toBe("going");
  });

  it("uses one visible word for a contraction and folds punctuation into the prior word", () => {
    const value = segment({
      endMs: 4_000,
      text: "And what's next.",
      words: [
        { ordinal: 0, startMs: 1_000, endMs: 1_300, text: "And", confidence: null },
        { ordinal: 1, startMs: 1_300, endMs: 1_600, text: "what", confidence: null },
        { ordinal: 2, startMs: 1_600, endMs: 1_750, text: "'s", confidence: null },
        { ordinal: 3, startMs: 1_750, endMs: 2_100, text: "next", confidence: null },
        { ordinal: 4, startMs: 2_100, endMs: 2_200, text: ".", confidence: null },
      ],
    });
    const fragments = getTimedCaptionFragments(value, 1_700);
    expect(fragments?.map((fragment) => fragment.text).join("")).toBe(value.text);
    expect(fragments?.filter((fragment) => fragment.kind === "timed").map((fragment) => fragment.text)).toEqual([
      "And",
      "what's",
      "next.",
    ]);
    expect(fragments?.find((fragment) => fragment.kind === "timed" && fragment.word.state === "current")?.text).toBe("what's");
  });

  it("skips inaccurate tokens without removing spaces, punctuation, or capitalization", () => {
    const value = segment({
      endMs: 4_000,
      text: "Is going to store the new memories.",
      words: [
        { ordinal: 0, startMs: 1_000, endMs: 1_300, text: "is", confidence: null },
        { ordinal: 1, startMs: 1_300, endMs: 1_700, text: "going", confidence: null },
        { ordinal: 2, startMs: 1_700, endMs: 2_000, text: "incorrect-token", confidence: null },
        { ordinal: 3, startMs: 2_000, endMs: 2_400, text: "store", confidence: null },
        { ordinal: 4, startMs: 2_400, endMs: 2_700, text: "the", confidence: null },
        { ordinal: 5, startMs: 2_700, endMs: 3_000, text: "new", confidence: null },
        { ordinal: 6, startMs: 3_000, endMs: 3_500, text: "memories", confidence: null },
      ],
    });
    const fragments = getTimedCaptionFragments(value, 2_200);
    expect(fragments?.map((fragment) => fragment.text).join("")).toBe(value.text);
    expect(fragments?.some((fragment) => fragment.kind === "timed" && fragment.text === "incorrect-token")).toBe(false);
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
    expect(getTimedCaptionFragments(value, 1_100)?.map((fragment) => fragment.text).join(""))
      .toBe(text);
  });
});
