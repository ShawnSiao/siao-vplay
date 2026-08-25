import { describe, expect, it } from "vitest";

import type { SubtitleSegment, SubtitleVersion } from "../../types";
import {
  buildTranscriptCues,
  findCurrentTranscriptCueIndex,
  formatTranscriptTime,
  searchTranscriptCues,
  transcriptCuesNearCurrent,
} from "./subtitleTranscriptModel";

function segment(
  id: string,
  startMs: number,
  endMs: number,
  text: string,
): SubtitleSegment {
  return {
    id,
    lineageId: id,
    sourceSegmentId: null,
    issueKind: null,
    ordinal: startMs,
    startMs,
    endMs,
    text,
    confidence: null,
    words: [],
  };
}

function version(
  role: SubtitleVersion["role"],
  segments: SubtitleSegment[],
): SubtitleVersion {
  return {
    id: `${role}-version`,
    trackId: `${role}-track`,
    projectId: "project",
    role,
    versionNumber: 1,
    status: "ready",
    sourceKind: role === "original" ? "transcription" : "agent_translation",
    sourceLabel: role,
    sourceSha256: role,
    mediaSha256: "media",
    languageCode: role === "original" ? "en" : "zh-cn",
    projectRevision: 1,
    parentVersionId: null,
    sourceTaskId: null,
    preflight: {} as SubtitleVersion["preflight"],
    createdAtMs: 1,
    isCurrent: true,
    segments,
  };
}

describe("subtitle transcript model", () => {
  it("matches tracks by time instead of array index", () => {
    const cues = buildTranscriptCues(
      version("original", [
        segment("o-late", 4_000, 5_000, "late"),
        segment("o-early", 1_000, 2_000, "early"),
      ]),
      version("translation", [
        segment("t-early", 1_100, 2_100, "早"),
        segment("t-extra", 2_700, 3_100, "额外译文"),
        segment("t-late", 4_100, 5_100, "晚"),
      ]),
    );

    expect(cues.map((cue) => [cue.originalText, cue.translatedText])).toEqual([
      ["early", "早"],
      ["", "额外译文"],
      ["late", "晚"],
    ]);
  });

  it("keeps missing translations empty and consumes each translation once", () => {
    const cues = buildTranscriptCues(
      version("original", [
        segment("o-1", 0, 2_000, "first"),
        segment("o-2", 1_000, 3_000, "second"),
      ]),
      version("translation", [segment("t-1", 500, 2_500, "唯一译文")]),
    );

    expect(cues).toHaveLength(2);
    expect(cues[0].translatedText).toBe("唯一译文");
    expect(cues[1].translatedText).toBeUndefined();
  });

  it("never highlights a future cue and uses the nearest previous cue in gaps", () => {
    const cues = buildTranscriptCues(
      version("original", [
        segment("one", 1_000, 2_000, "one"),
        segment("two", 4_000, 5_000, "two"),
      ]),
      null,
    );
    expect(findCurrentTranscriptCueIndex(cues, 500)).toBe(-1);
    expect(findCurrentTranscriptCueIndex(cues, 1_500)).toBe(0);
    expect(findCurrentTranscriptCueIndex(cues, 3_000)).toBe(0);
    expect(findCurrentTranscriptCueIndex(cues, 4_100)).toBe(1);
  });

  it("searches visible text and time but never internal identifiers", () => {
    const cues = buildTranscriptCues(
      version("original", [
        segment("secret-internal-uuid", 62_000, 64_000, "memory systems"),
      ]),
      version("translation", [
        segment("translation-uuid", 62_100, 64_100, "记忆系统"),
      ]),
    );
    expect(searchTranscriptCues(cues, "memory")).toHaveLength(1);
    expect(searchTranscriptCues(cues, "记忆")).toHaveLength(1);
    expect(searchTranscriptCues(cues, "01:02")).toHaveLength(1);
    expect(searchTranscriptCues(cues, "secret-internal-uuid")).toEqual([]);
    expect(formatTranscriptTime(3_723_000)).toBe("01:02:03");
  });

  it("bounds the nearby range and handles five thousand cues", () => {
    const originals = Array.from({ length: 5_000 }, (_, index) =>
      segment(`cue-${index}`, index * 2_000, index * 2_000 + 1_500, `line ${index}`),
    );
    const cues = buildTranscriptCues(version("original", originals), null);
    const current = findCurrentTranscriptCueIndex(cues, 5_000_100);
    expect(current).toBe(2_500);
    expect(transcriptCuesNearCurrent(cues, current)).toHaveLength(25);
  });
});
