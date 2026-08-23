import {
  type CSSProperties,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { SubtitleSegment } from "../../types";
import type { SubtitleFollowPreferences, SubtitlePosition } from "./playbackPreferences";
import { KaraokeCaptionLine } from "./KaraokeCaptionLine";
import { useMediaPlaybackClock } from "./useMediaPlaybackClock";
import "./PlayerCaptionStack.css";

type PlayerCaptionStackProps = {
  mode: "translation" | "original" | "bilingual";
  original: SubtitleSegment | null;
  translation: SubtitleSegment | null;
  originalLanguage?: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  playing: boolean;
  positionMs: number;
  fullscreen: boolean;
  preferences: SubtitleFollowPreferences;
  onPositionCommit: (position: SubtitlePosition) => void;
  onTogglePlayback: () => void;
};

const safeMargin = 12;
const dragThreshold = 4;

export function PlayerCaptionStack({
  mode,
  original,
  translation,
  originalLanguage,
  videoRef,
  stageRef,
  playing,
  positionMs,
  fullscreen,
  preferences,
  onPositionCommit,
  onTogglePlayback,
}: PlayerCaptionStackProps) {
  const captionRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startPosition: SubtitlePosition; currentPosition: SubtitlePosition; moved: boolean } | null>(null);
  const [dragPosition, setDragPosition] = useState<SubtitlePosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const playbackPositionMs = useMediaPlaybackClock(videoRef, playing, positionMs);
  const position = dragPosition ?? preferences.position;
  const renderedPosition = fullscreen
    ? { ...position, y: Math.min(position.y, 0.82) }
    : position;
  if (!original && !translation) return null;

  const updateDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    const caption = captionRef.current;
    if (!drag || !stage || !caption || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) >= dragThreshold) drag.moved = true;
    if (!drag.moved) return;
    const stageRect = stage.getBoundingClientRect();
    const captionRect = caption.getBoundingClientRect();
    const bottomInset = fullscreen ? 88 : 0;
    const halfWidth = captionRect.width / 2;
    const minX = (halfWidth + safeMargin) / stageRect.width;
    const maxX = 1 - minX;
    const minY = (captionRect.height + safeMargin) / stageRect.height;
    const maxY = 1 - bottomInset / stageRect.height;
    const nextPosition = {
      x: Math.max(minX, Math.min(maxX, drag.startPosition.x + dx / stageRect.width)),
      y: Math.max(minY, Math.min(maxY, drag.startPosition.y + dy / stageRect.height)),
    };
    drag.currentPosition = nextPosition;
    setDragPosition(nextPosition);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (drag.moved) onPositionCommit(drag.currentPosition);
    else onTogglePlayback();
    setDragPosition(null);
  };

  return (
    <div
      ref={captionRef}
      className={`caption-stack${dragging ? " dragging" : ""}`}
      aria-live="off"
      aria-label="字幕，可拖动调整位置"
      style={{ left: `${renderedPosition.x * 100}%`, top: `${renderedPosition.y * 100}%`, "--caption-base": preferences.baseTextColor } as CSSProperties}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPosition: renderedPosition, currentPosition: renderedPosition, moved: false };
        setDragging(true);
      }}
      onPointerMove={updateDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {(mode === "original" || mode === "bilingual") && original ? (
        <KaraokeCaptionLine segment={original} positionMs={playbackPositionMs} enabled={preferences.enabled} highlightColor={preferences.highlightColor} language={originalLanguage} />
      ) : null}
      {(mode === "translation" || mode === "bilingual") && translation ? (
        <p className="caption-line translation" lang="zh-CN">
          {translation.text}
        </p>
      ) : null}
    </div>
  );
}
