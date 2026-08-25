import type { Ref } from "react";

import type { SubtitleDisplayMode } from "../../types";
import type { SubtitleTextSize } from "./playbackPreferences";
import "./CaptionQuickToolbar.css";

type CaptionQuickToolbarProps = {
  mode: SubtitleDisplayMode;
  size: SubtitleTextSize;
  targetLabel: string;
  originalAvailable: boolean;
  translationAvailable: boolean;
  transcriptOpen: boolean;
  visible: boolean;
  transcriptButtonRef?: Ref<HTMLButtonElement>;
  onChangeMode: (mode: SubtitleDisplayMode) => void;
  onChangeSize: (size: SubtitleTextSize) => void;
  onToggleTranscript: () => void;
  onHideCaptions: () => void;
};

function sourceToggleLabel(mode: SubtitleDisplayMode) {
  if (mode === "bilingual") return "隐藏原文";
  if (mode === "translation") return "显示原文";
  return "显示译文";
}

export function CaptionQuickToolbar({
  mode,
  size,
  targetLabel,
  originalAvailable,
  translationAvailable,
  transcriptOpen,
  visible,
  transcriptButtonRef,
  onChangeMode,
  onChangeSize,
  onToggleTranscript,
  onHideCaptions,
}: CaptionQuickToolbarProps) {
  const sourceToggleDisabled =
    (mode === "translation" && !originalAvailable) ||
    (mode === "original" && !translationAvailable);
  const toggleSource = () => {
    if (mode === "bilingual") onChangeMode("translation");
    else onChangeMode("bilingual");
  };

  return (
    <div
      aria-label="字幕快捷控制"
      className="caption-quick-toolbar"
      data-visible={visible}
      role="toolbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label className="caption-language-control">
        <span>翻译为</span>
        <select aria-label="译文轨" disabled={!translationAvailable} value={targetLabel}>
          <option value={targetLabel}>{targetLabel}</option>
        </select>
      </label>
      <button
        aria-pressed={mode === "bilingual"}
        type="button"
        disabled={sourceToggleDisabled}
        onClick={toggleSource}
      >
        {sourceToggleLabel(mode)}
      </button>
      <label className="caption-size-control">
        <span className="sr-only">字幕字号</span>
        <select
          aria-label="字幕字号"
          value={size}
          onChange={(event) => onChangeSize(event.target.value as SubtitleTextSize)}
        >
          <option value="small">小号</option>
          <option value="medium">中号</option>
          <option value="large">大号</option>
        </select>
      </label>
      <button
        ref={transcriptButtonRef}
        aria-controls="player-drawer-panel-transcript"
        aria-expanded={transcriptOpen}
        type="button"
        onClick={onToggleTranscript}
      >
        {transcriptOpen ? "收起字幕" : "展开字幕"}
      </button>
      <button
        aria-label="关闭字幕"
        className="caption-quick-close"
        title="临时关闭字幕"
        type="button"
        onClick={onHideCaptions}
      >
        ×
      </button>
    </div>
  );
}

type CaptionsOffNoticeProps = {
  onRestore: () => void;
};

export function CaptionsOffNotice({ onRestore }: CaptionsOffNoticeProps) {
  return (
    <div className="captions-off-notice" role="status">
      <span>字幕已关闭</span>
      <button type="button" onClick={onRestore}>重新显示字幕</button>
    </div>
  );
}
