import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SubtitleSegment } from "../../types";
import { defaultSubtitleDisplayPreferences } from "./playbackPreferences";
import { PlayerCaptionStack } from "./PlayerCaptionStack";

function subtitle(id: string, text: string): SubtitleSegment {
  return {
    id,
    lineageId: id,
    sourceSegmentId: null,
    issueKind: null,
    ordinal: 0,
    startMs: 0,
    endMs: 4_000,
    text,
    confidence: null,
    words: [],
  };
}

describe("PlayerCaptionStack quick controls", () => {
  it("applies display size and isolates toolbar pointer actions from dragging", () => {
    const videoRef = { current: document.createElement("video") };
    const stageRef = { current: document.createElement("div") };
    const transcriptButtonRef = createRef<HTMLButtonElement>();
    const onTogglePlayback = vi.fn();
    const onChangeMode = vi.fn();
    const onChangePreferences = vi.fn();
    render(
      <PlayerCaptionStack
        mode="bilingual"
        original={subtitle("original", "Original line")}
        translation={subtitle("translation", "译文")}
        videoRef={videoRef}
        stageRef={stageRef}
        playing={false}
        positionMs={1_000}
        fullscreen={false}
        preferences={{ ...defaultSubtitleDisplayPreferences, textSize: "large" }}
        transcriptOpen={false}
        quickToolbarVisible
        transcriptButtonRef={transcriptButtonRef}
        onPositionCommit={vi.fn()}
        onTogglePlayback={onTogglePlayback}
        onChangeMode={onChangeMode}
        onChangePreferences={onChangePreferences}
        onToggleTranscript={vi.fn()}
        onHideCaptions={vi.fn()}
      />,
    );

    const caption = screen.getByLabelText("字幕，可拖动调整位置或边缘调整尺寸");
    expect(caption).toHaveAttribute("data-text-size", "large");
    const toggle = screen.getByRole("button", { name: "隐藏原文" });
    fireEvent.pointerDown(toggle, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(toggle, { button: 0, pointerId: 1 });
    fireEvent.click(toggle);
    expect(onChangeMode).toHaveBeenCalledWith("translation");
    expect(onTogglePlayback).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("combobox", { name: "字幕字号" }), {
      target: { value: "small" },
    });
    expect(onChangePreferences).toHaveBeenCalledWith({
      ...defaultSubtitleDisplayPreferences,
      textSize: "small",
    });
  });

  it("resizes from the keyboard without toggling playback", () => {
    const videoRef = { current: document.createElement("video") };
    const stage = document.createElement("div");
    const stageRef = { current: stage };
    const onTogglePlayback = vi.fn();
    const onChangePreferences = vi.fn();
    render(
      <PlayerCaptionStack
        mode="bilingual"
        original={subtitle("original", "Original line")}
        translation={subtitle("translation", "译文")}
        videoRef={videoRef}
        stageRef={stageRef}
        playing={false}
        positionMs={1_000}
        fullscreen={false}
        preferences={defaultSubtitleDisplayPreferences}
        transcriptOpen={false}
        quickToolbarVisible
        transcriptButtonRef={createRef<HTMLButtonElement>()}
        onPositionCommit={vi.fn()}
        onTogglePlayback={onTogglePlayback}
        onChangeMode={vi.fn()}
        onChangePreferences={onChangePreferences}
        onToggleTranscript={vi.fn()}
        onHideCaptions={vi.fn()}
      />,
    );

    const caption = screen.getByLabelText("字幕，可拖动调整位置或边缘调整尺寸");
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1_000,
      height: 600,
    } as DOMRect);
    vi.spyOn(caption, "getBoundingClientRect").mockReturnValue({
      left: 200,
      top: 360,
      width: 600,
      height: 120,
    } as DOMRect);

    fireEvent.keyDown(
      screen.getByRole("button", { name: "调整字幕框宽度" }),
      { key: "ArrowRight" },
    );

    expect(onChangePreferences).toHaveBeenCalledWith({
      ...defaultSubtitleDisplayPreferences,
      frameSize: { widthRatio: 0.616, minHeightRatio: null },
      position: { x: 0.508, y: 0.9 },
    });
    expect(onTogglePlayback).not.toHaveBeenCalled();
  });
});
