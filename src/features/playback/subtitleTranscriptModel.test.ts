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
  it("keeps simultaneous speakers attached to their source when translation order differs", () => {
    const cues = buildTranscriptCues(version("original", [
      segment("speaker-a", 1_000, 3_000, "Alice: stay"),
      segment("speaker-b", 1_000, 3_000, "Bob: go"),
    ]), version("translation", [
      { ...segment("tb", 1_000, 3_000, "鲍勃：走"), sourceSegmentId: "speaker-b" },
      { ...segment("ta", 1_000, 3_000, "爱丽丝：留下"), sourceSegmentId: "speaker-a" },
    ]));
    expect(cues).toHaveLength(2);
    expect(cues.find((cue) => cue.originalSegmentId === "speaker-a")?.translatedText)
      .toBe("爱丽丝：留下");
    expect(cues.find((cue) => cue.originalSegmentId === "speaker-b")?.translatedText)
      .toBe("鲍勃：走");
  });

  it("uses source lineage after a whole-track offset without shifting translations to adjacent lines", () => {
    const cues = buildTranscriptCues(version("original", [
      { ...segment("revised-a", 11_000, 12_000, "first"), lineageId: "old-a" },
      { ...segment("revised-b", 21_000, 22_000, "second"), lineageId: "old-b" },
    ]), version("translation", [
      { ...segment("ta", 1_000, 2_000, "第一句"), sourceSegmentId: "old-a" },
      { ...segment("tb", 11_000, 12_000, "第二句"), sourceSegmentId: "old-b" },
    ]));
    expect(cues.map((cue) => [cue.startMs, cue.originalText, cue.translatedText])).toEqual([
      [11_000, "first", "第一句"],
      [21_000, "second", "第二句"],
    ]);
  });

  it("honors source identity before overlapping timestamps", () => {
    const translated = { ...segment("t", 900, 2_500, "第二句"), sourceSegmentId: "o-2" };
    const cues = buildTranscriptCues(version("original", [
      segment("o-1", 0, 2_000, "first"),
      segment("o-2", 1_000, 3_000, "second"),
    ]), version("translation", [translated]));
    expect(cues.map((cue) => cue.translatedText)).toEqual([undefined, "第二句"]);
    expect(cues[1].startMs).toBe(1_000);
  });

  it("keeps orphaned source references separate instead of guessing by time", () => {
    const cues = buildTranscriptCues(version("original", [segment("o", 0, 2_000, "new")]),
      version("translation", [{ ...segment("t", 0, 2_000, "旧译文"), sourceSegmentId: "deleted" }]));
    expect(cues).toHaveLength(2);
    expect(cues.find((cue) => cue.originalSegmentId === "o")?.translatedText).toBeUndefined();
  });

  it("resolves a preserved original lineage after revision", () => {
    const cues = buildTranscriptCues(version("original", [
      { ...segment("revised", 1_000, 2_000, "edited"), lineageId: "old-original" },
    ]), version("translation", [
      { ...segment("t", 0, 1_000, "译文"), sourceSegmentId: "old-original" },
    ]));
    expect(cues).toHaveLength(1);
    expect(cues[0].originalSegmentId).toBe("revised");
  });

  it("does not attach an imported translation to an earlier overlapping cue", () => {
    const cues = buildTranscriptCues(version("original", [
      segment("o-1", 0, 2_000, "first"), segment("o-2", 1_000, 3_000, "second"),
    ]), version("translation", [segment("t", 1_000, 3_000, "第二句")]));
    expect(cues.map((cue) => cue.translatedText)).toEqual([undefined, "第二句"]);
  });

  it("shows no future text before the first cue", () => {
    const cues = buildTranscriptCues(version("original", [segment("o", 1_000, 2_000, "future")]), null);
    expect(transcriptCuesNearCurrent(cues, -1)).toEqual([]);
  });
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
    expect(transcriptCuesNearCurrent(cues, current)).toHaveLength(13);
    expect(transcriptCuesNearCurrent(cues, current).at(-1)).toBe(cues[current]);
  });
});
