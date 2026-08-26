import { describe, expect, it } from "vitest";

import { calculateCaptionFrameUpdate } from "./captionFrameSizing";

const stageRect = { left: 0, top: 0, width: 1_000, height: 600 };
const captionRect = { left: 200, top: 360, width: 600, height: 120 };
const startPosition = { x: 0.5, y: 0.8 };
const startFrameSize = { widthRatio: 0.6, minHeightRatio: 0.2 };

describe("calculateCaptionFrameUpdate", () => {
  it("keeps the left edge fixed while resizing width", () => {
    expect(
      calculateCaptionFrameUpdate({
        axis: "width",
        deltaX: 100,
        deltaY: 0,
        stageRect,
        captionRect,
        startPosition,
        startFrameSize,
        fullscreen: false,
      }),
    ).toEqual({
      frameSize: { widthRatio: 0.7, minHeightRatio: 0.2 },
      position: { x: 0.55, y: 0.8 },
    });
  });

  it("keeps the top edge fixed while resizing height", () => {
    expect(
      calculateCaptionFrameUpdate({
        axis: "height",
        deltaX: 0,
        deltaY: 60,
        stageRect,
        captionRect,
        startPosition,
        startFrameSize,
        fullscreen: false,
      }),
    ).toEqual({
      frameSize: { widthRatio: 0.6, minHeightRatio: 0.3 },
      position: { x: 0.5, y: 0.9 },
    });
  });

  it("clamps the frame to the safe viewing area", () => {
    expect(
      calculateCaptionFrameUpdate({
        axis: "both",
        deltaX: 900,
        deltaY: 900,
        stageRect,
        captionRect,
        startPosition,
        startFrameSize,
        fullscreen: true,
      }),
    ).toEqual({
      frameSize: { widthRatio: 0.788, minHeightRatio: 152 / 600 },
      position: { x: 0.594, y: 512 / 600 },
    });
  });

  it("never persists a frame below the preference validation limits", () => {
    expect(
      calculateCaptionFrameUpdate({
        axis: "both",
        deltaX: -900,
        deltaY: -900,
        stageRect: { left: 0, top: 0, width: 1_600, height: 1_080 },
        captionRect: { left: 400, top: 700, width: 800, height: 180 },
        startPosition: { x: 0.5, y: 880 / 1_080 },
        startFrameSize,
        fullscreen: false,
      }),
    ).toMatchObject({
      frameSize: { widthRatio: 0.3, minHeightRatio: 0.1 },
    });
  });
});
