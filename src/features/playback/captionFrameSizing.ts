import type {
  SubtitleFrameSize,
  SubtitlePosition,
} from "./playbackPreferences";

export type CaptionResizeAxis = "width" | "height" | "both";

type Rect = Pick<DOMRect, "left" | "top" | "width" | "height">;

export type CaptionFrameGeometry = {
  axis: CaptionResizeAxis;
  deltaX: number;
  deltaY: number;
  stageRect: Rect;
  captionRect: Rect;
  startPosition: SubtitlePosition;
  startFrameSize: SubtitleFrameSize;
  fullscreen: boolean;
};

export type CaptionFrameUpdate = {
  frameSize: SubtitleFrameSize;
  position: SubtitlePosition;
};

const safeMargin = 12;
const minimumWidthPixels = 280;
const minimumHeightPixels = 96;
const minimumWidthRatio = 0.3;
const minimumHeightRatio = 0.1;
const maximumWidthRatio = 0.94;
const maximumHeightRatio = 0.55;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function resizeAxisIncludes(axis: CaptionResizeAxis, dimension: "width" | "height") {
  return axis === dimension || axis === "both";
}

export function calculateCaptionFrameUpdate({
  axis,
  deltaX,
  deltaY,
  stageRect,
  captionRect,
  startPosition,
  startFrameSize,
  fullscreen,
}: CaptionFrameGeometry): CaptionFrameUpdate {
  if (stageRect.width <= 0 || stageRect.height <= 0) {
    return { frameSize: startFrameSize, position: startPosition };
  }

  const startLeft = captionRect.left - stageRect.left;
  const startTop = captionRect.top - stageRect.top;
  const bottomInset = fullscreen ? 88 : safeMargin;
  const maximumWidth = Math.max(
    0,
    Math.min(stageRect.width * maximumWidthRatio, stageRect.width - safeMargin - startLeft),
  );
  const maximumHeight = Math.max(
    0,
    Math.min(stageRect.height * maximumHeightRatio, stageRect.height - bottomInset - startTop),
  );
  const minimumWidth = Math.max(
    minimumWidthPixels,
    stageRect.width * minimumWidthRatio,
  );
  const minimumHeight = Math.max(
    minimumHeightPixels,
    stageRect.height * minimumHeightRatio,
  );
  const nextWidth = clamp(
    captionRect.width + deltaX,
    Math.min(minimumWidth, maximumWidth),
    maximumWidth,
  );
  const nextHeight = clamp(
    captionRect.height + deltaY,
    Math.min(minimumHeight, maximumHeight),
    maximumHeight,
  );
  const resizeWidth = resizeAxisIncludes(axis, "width");
  const resizeHeight = resizeAxisIncludes(axis, "height");

  return {
    frameSize: {
      widthRatio: resizeWidth
        ? nextWidth / stageRect.width
        : startFrameSize.widthRatio,
      minHeightRatio: resizeHeight
        ? nextHeight / stageRect.height
        : startFrameSize.minHeightRatio,
    },
    position: {
      x: resizeWidth
        ? (startLeft + nextWidth / 2) / stageRect.width
        : startPosition.x,
      y: resizeHeight
        ? (startTop + nextHeight) / stageRect.height
        : startPosition.y,
    },
  };
}
