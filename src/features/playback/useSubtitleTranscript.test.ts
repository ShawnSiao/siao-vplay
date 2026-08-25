import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubtitleVersion } from "../../types";
import { useSubtitleTranscript } from "./useSubtitleTranscript";

function version(id: string, text: string): SubtitleVersion {
  return {
    id,
    trackId: id,
    projectId: "project",
    role: "original",
    versionNumber: 1,
    status: "ready",
    sourceKind: "transcription",
    sourceLabel: id,
    sourceSha256: id,
    mediaSha256: "media",
    languageCode: "en",
    projectRevision: 1,
    parentVersionId: null,
    sourceTaskId: null,
    preflight: {} as SubtitleVersion["preflight"],
    createdAtMs: 1,
    isCurrent: true,
    segments: [{
      id: `${id}-segment`,
      lineageId: `${id}-segment`,
      sourceSegmentId: null,
      issueKind: null,
      ordinal: 0,
      startMs: 1_000,
      endMs: 2_000,
      text,
      confidence: null,
      words: [],
    }],
  };
}

describe("useSubtitleTranscript", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces search and exposes manual follow control", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useSubtitleTranscript({
        originalVersion: version("first", "memory systems"),
        translatedVersion: null,
        positionMs: 1_500,
      }),
    );

    act(() => result.current.setQuery("missing"));
    expect(result.current.visibleCues).toHaveLength(1);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.visibleCues).toEqual([]);
    act(() => result.current.pauseFollowing());
    expect(result.current.following).toBe(false);
    act(() => result.current.resumeFollowing());
    expect(result.current.following).toBe(true);
  });

  it("rebuilds the current index when subtitle versions change", () => {
    const first = version("first", "first line");
    const second = {
      ...version("second", "second line"),
      segments: [{
        ...version("second", "second line").segments[0],
        startMs: 4_000,
        endMs: 5_000,
      }],
    };
    const { result, rerender } = renderHook(
      ({ source }) =>
        useSubtitleTranscript({
          originalVersion: source,
          translatedVersion: null,
          positionMs: 3_000,
        }),
      { initialProps: { source: first } },
    );
    expect(result.current.currentIndex).toBe(0);
    rerender({ source: second });
    expect(result.current.visibleCues[0]?.originalText).toBe("second line");
    expect(result.current.currentIndex).toBe(-1);
  });
});
