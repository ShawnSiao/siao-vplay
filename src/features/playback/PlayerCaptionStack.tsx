import {
  type CSSProperties,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { SubtitleSegment } from "../../types";
import type { SubtitleDisplayMode } from "../../types";
import type { SubtitleDisplayPreferences, SubtitlePosition } from "./playbackPreferences";
import { CaptionQuickToolbar } from "./CaptionQuickToolbar";
import { CaptionResizeHandles } from "./CaptionResizeHandles";
import type { CaptionFrameUpdate } from "./captionFrameSizing";
import { KaraokeCaptionLine } from "./KaraokeCaptionLine";
import { useMediaPlaybackClock } from "./useMediaPlaybackClock";
import "./PlayerCaptionStack.css";

type PlayerCaptionStackProps = {
  mode: SubtitleDisplayMode;
  original: SubtitleSegment | null;
  translation: SubtitleSegment | null;
  originalLanguage?: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  playing: boolean;
  positionMs: number;
  fullscreen: boolean;
  preferences: SubtitleDisplayPreferences;
  transcriptOpen: boolean;
  quickToolbarVisible: boolean;
  transcriptButtonRef: RefObject<HTMLButtonElement | null>;
  onPositionCommit: (position: SubtitlePosition) => void;
  onTogglePlayback: () => void;
  onChangeMode: (mode: SubtitleDisplayMode) => void;
  onChangePreferences: (preferences: SubtitleDisplayPreferences) => void;
  onToggleTranscript: () => void;
  onHideCaptions: () => void;
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
  transcriptOpen,
  quickToolbarVisible,
  transcriptButtonRef,
  onPositionCommit,
  onTogglePlayback,
  onChangeMode,
  onChangePreferences,
  onToggleTranscript,
  onHideCaptions,
}: PlayerCaptionStackProps) {
  const captionRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startPosition: SubtitlePosition; currentPosition: SubtitlePosition; moved: boolean } | null>(null);
  const [dragPosition, setDragPosition] = useState<SubtitlePosition | null>(null);
  const [resizePreview, setResizePreview] = useState<CaptionFrameUpdate | null>(null);
  const [dragging, setDragging] = useState(false);
  const playbackPositionMs = useMediaPlaybackClock(videoRef, playing, positionMs);
  const position = dragPosition ?? resizePreview?.position ?? preferences.position;
  const frameSize = resizePreview?.frameSize ?? preferences.frameSize;
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
      className={`caption-stack${dragging ? " dragging" : ""}${resizePreview ? " resizing" : ""}`}
      data-text-size={preferences.textSize}
      data-controls-visible={quickToolbarVisible}
      aria-live="off"
      aria-label="字幕，可拖动调整位置或边缘调整尺寸"
      style={{ left: `${renderedPosition.x * 100}%`, top: `${renderedPosition.y * 100}%`, width: frameSize.widthRatio === null ? undefined : `${frameSize.widthRatio * 100}%`, minHeight: frameSize.minHeightRatio === null ? undefined : `${frameSize.minHeightRatio * 100}%`, "--caption-base": preferences.baseTextColor, "--caption-transcript-overlay-shift": `${renderedPosition.x * 396}px` } as CSSProperties}
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
      {preferences.quickToolbar !== "hidden" ? (
        <CaptionQuickToolbar
          mode={mode}
          size={preferences.textSize}
          targetLabel={translation ? "简体中文" : "暂无译文"}
          originalAvailable={Boolean(original)}
          translationAvailable={Boolean(translation)}
          transcriptOpen={transcriptOpen}
          visible={quickToolbarVisible}
          transcriptButtonRef={transcriptButtonRef}
          onChangeMode={onChangeMode}
          onChangeSize={(textSize) => onChangePreferences({ ...preferences, textSize })}
          onToggleTranscript={onToggleTranscript}
          onHideCaptions={onHideCaptions}
        />
      ) : null}
      <div className="caption-copy">
        {(mode === "original" || mode === "bilingual") && original ? (
          <KaraokeCaptionLine segment={original} positionMs={playbackPositionMs} enabled={preferences.enabled} highlightColor={preferences.highlightColor} language={originalLanguage} />
        ) : null}
        {(mode === "translation" || mode === "bilingual") && translation ? (
          <p className="caption-line translation" lang="zh-CN">
            {translation.text}
          </p>
        ) : null}
      </div>
      <CaptionResizeHandles
        captionRef={captionRef}
        stageRef={stageRef}
        position={renderedPosition}
        frameSize={frameSize}
        fullscreen={fullscreen}
        onPreview={setResizePreview}
        onCommit={(update) => {
          onChangePreferences({
            ...preferences,
            frameSize: update.frameSize,
            position: update.position,
          });
          setResizePreview(null);
        }}
      />
    </div>
  );
}
