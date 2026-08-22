import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerControls } from "./PlayerControls";

function renderControls() {
  const onSeekTo = vi.fn();
  const onChangeSeekStep = vi.fn();
  render(
    <PlayerControls
      playing={false}
      muted={false}
      fullscreen={false}
      positionMs={15_000}
      durationMs={120_000}
      volume={0.8}
      playbackRate={1}
      subtitleMode="original"
      originalSubtitleAvailable
      translationAvailable={false}
      mediaTitle="测试视频"
      previousEpisode={null}
      nextEpisode={null}
      switchingEpisode={false}
      seekStepSeconds={10}
      onSwitchEpisode={() => undefined}
      onTogglePlayback={() => undefined}
      onToggleMuted={() => undefined}
      onToggleFullscreen={() => undefined}
      onSeekTo={onSeekTo}
      onChangeVolume={() => undefined}
      onChangePlaybackRate={() => undefined}
      onChangeSubtitleMode={() => undefined}
      onChangeSeekStep={onChangeSeekStep}
    />,
  );
  return { onSeekTo, onChangeSeekStep };
}

describe("PlayerControls", () => {
  it("exposes bounded seek actions and a configurable duration", () => {
    const { onSeekTo, onChangeSeekStep } = renderControls();
    fireEvent.click(screen.getByRole("button", { name: "快退 10 秒" }));
    fireEvent.click(screen.getByRole("button", { name: "快进 10 秒" }));
    expect(onSeekTo.mock.calls).toEqual([[5_000], [25_000]]);

    fireEvent.change(screen.getByRole("combobox", { name: "快进快退时长" }), {
      target: { value: "30" },
    });
    expect(onChangeSeekStep).toHaveBeenCalledWith(30);
  });
});
