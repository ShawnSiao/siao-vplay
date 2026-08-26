import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import {
  calculateCaptionFrameUpdate,
  type CaptionFrameUpdate,
  type CaptionResizeAxis,
} from "./captionFrameSizing";
import type {
  SubtitleFrameSize,
  SubtitlePosition,
} from "./playbackPreferences";

type Props = {
  captionRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  position: SubtitlePosition;
  frameSize: SubtitleFrameSize;
  fullscreen: boolean;
  onPreview: (update: CaptionFrameUpdate | null) => void;
  onCommit: (update: CaptionFrameUpdate) => void;
};

type ResizeSession = {
  pointerId: number;
  axis: CaptionResizeAxis;
  startX: number;
  startY: number;
  stageRect: DOMRect;
  captionRect: DOMRect;
  startPosition: SubtitlePosition;
  startFrameSize: SubtitleFrameSize;
  latest: CaptionFrameUpdate;
};

const keyboardStep = 16;

function handleLabel(axis: CaptionResizeAxis) {
  if (axis === "width") return "调整字幕框宽度";
  if (axis === "height") return "调整字幕框高度";
  return "同时调整字幕框宽度和高度";
}

export function CaptionResizeHandles({
  captionRef,
  stageRef,
  position,
  frameSize,
  fullscreen,
  onPreview,
  onCommit,
}: Props) {
  const resizeRef = useRef<ResizeSession | null>(null);

  const calculate = (
    axis: CaptionResizeAxis,
    deltaX: number,
    deltaY: number,
    stageRect: DOMRect,
    captionRect: DOMRect,
    resizePosition = position,
    resizeFrameSize = frameSize,
  ) =>
    calculateCaptionFrameUpdate({
      axis,
      deltaX,
      deltaY,
      stageRect,
      captionRect,
      startPosition: resizePosition,
      startFrameSize: resizeFrameSize,
      fullscreen,
    });

  const startResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    axis: CaptionResizeAxis,
  ) => {
    if (event.button !== 0 || !stageRef.current || !captionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      axis,
      startX: event.clientX,
      startY: event.clientY,
      stageRect: stageRef.current.getBoundingClientRect(),
      captionRect: captionRef.current.getBoundingClientRect(),
      startPosition: { ...position },
      startFrameSize: { ...frameSize },
      latest: { frameSize, position },
    };
  };

  const previewResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = resizeRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    session.latest = calculate(
      session.axis,
      event.clientX - session.startX,
      event.clientY - session.startY,
      session.stageRect,
      session.captionRect,
      session.startPosition,
      session.startFrameSize,
    );
    onPreview(session.latest);
  };

  const finishResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    commit: boolean,
  ) => {
    const session = resizeRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    resizeRef.current = null;
    if (commit) onCommit(session.latest);
    onPreview(null);
  };

  const resizeWithKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    axis: CaptionResizeAxis,
  ) => {
    if (!stageRef.current || !captionRef.current) return;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowLeft" && axis !== "height") deltaX = -keyboardStep;
    else if (event.key === "ArrowRight" && axis !== "height") deltaX = keyboardStep;
    else if (event.key === "ArrowUp" && axis !== "width") deltaY = -keyboardStep;
    else if (event.key === "ArrowDown" && axis !== "width") deltaY = keyboardStep;
    else return;
    event.preventDefault();
    event.stopPropagation();
    onCommit(
      calculate(
        axis,
        deltaX,
        deltaY,
        stageRef.current.getBoundingClientRect(),
        captionRef.current.getBoundingClientRect(),
      ),
    );
  };

  return (
    <>
      {(["width", "height", "both"] as const).map((axis) => (
        <button
          key={axis}
          aria-label={handleLabel(axis)}
          className={`caption-resize-handle ${axis}`}
          title="拖动边缘调整字幕框"
          type="button"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => resizeWithKeyboard(event, axis)}
          onPointerDown={(event) => startResize(event, axis)}
          onPointerMove={previewResize}
          onPointerUp={(event) => finishResize(event, true)}
          onPointerCancel={(event) => finishResize(event, false)}
        />
      ))}
    </>
  );
}
