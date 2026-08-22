import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SubtitleSegment } from "../../types";
import { KaraokeCaptionLine } from "./KaraokeCaptionLine";

const segment: SubtitleSegment = {
  id: "segment-1",
  lineageId: "lineage-1",
  sourceSegmentId: null,
  issueKind: null,
  ordinal: 0,
  startMs: 0,
  endMs: 2_000,
  text: "And this",
  confidence: null,
  words: [
    { ordinal: 0, startMs: 0, endMs: 1_000, text: "And", confidence: null },
    { ordinal: 1, startMs: 1_000, endMs: 2_000, text: " this", confidence: null },
  ],
};

describe("KaraokeCaptionLine", () => {
  it("adds a non-color cue and configured partial gradient to the current word", () => {
    const { container } = render(<KaraokeCaptionLine segment={segment} positionMs={500} enabled highlightColor="#fb923c" />);
    const current = container.querySelector(".caption-word.current");
    expect(current).toHaveTextContent("And");
    expect(current).toHaveStyle({ "--caption-highlight": "#fb923c", "--caption-progress": "50%" });
  });

  it("renders the original full sentence when following is disabled", () => {
    const { container } = render(<KaraokeCaptionLine segment={segment} positionMs={500} enabled={false} highlightColor="#fb923c" />);
    expect(screen.getByText("And this")).toBeInTheDocument();
    expect(container.querySelectorAll(".caption-word")).toHaveLength(0);
  });

  it("does not fabricate timing when the segment has no word data", () => {
    const { container } = render(<KaraokeCaptionLine segment={{ ...segment, words: [] }} positionMs={500} enabled highlightColor="#fb923c" />);
    expect(screen.getByText("And this")).toBeInTheDocument();
    expect(container.querySelectorAll(".caption-word")).toHaveLength(0);
  });
});
