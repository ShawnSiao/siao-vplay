import { formatDuration } from "../../lib/format";
import type {
  EpisodeReference,
  SubtitleDisplayMode,
} from "../../types";
import {
  seekStepOptions,
  type SubtitleFollowPreferences,
  type SeekStepSeconds,
} from "./playbackPreferences";
import { SubtitleAppearancePopover } from "./SubtitleAppearancePopover";
import "./PlayerControls.css";

type PlayerControlsProps = {
  playing: boolean;
  muted: boolean;
  fullscreen: boolean;
  positionMs: number;
  durationMs: number | null;
  volume: number;
  playbackRate: number;
  subtitleMode: SubtitleDisplayMode;
  originalSubtitleAvailable: boolean;
  translationAvailable: boolean;
  mediaTitle: string;
  previousEpisode: EpisodeReference | null;
  nextEpisode: EpisodeReference | null;
  switchingEpisode: boolean;
  seekStepSeconds: SeekStepSeconds;
  subtitleFollowPreferences: SubtitleFollowPreferences;
  onSwitchEpisode: (episode: EpisodeReference) => void;
  onTogglePlayback: () => void;
  onToggleMuted: () => void;
  onToggleFullscreen: () => void;
  onSeekTo: (positionMs: number) => void;
  onChangeVolume: (volume: number) => void;
  onChangePlaybackRate: (rate: number) => void;
  onChangeSubtitleMode: (mode: SubtitleDisplayMode) => void;
  onChangeSeekStep: (seconds: SeekStepSeconds) => void;
  onChangeSubtitleFollowPreferences: (preferences: SubtitleFollowPreferences) => void;
};

export function PlayerControls({
  playing,
  muted,
  fullscreen,
  positionMs,
  durationMs,
  volume,
  playbackRate,
  subtitleMode,
  originalSubtitleAvailable,
  translationAvailable,
  mediaTitle,
  previousEpisode,
  nextEpisode,
  switchingEpisode,
  seekStepSeconds,
  subtitleFollowPreferences,
  onSwitchEpisode,
  onTogglePlayback,
  onToggleMuted,
  onToggleFullscreen,
  onSeekTo,
  onChangeVolume,
  onChangePlaybackRate,
  onChangeSubtitleMode,
  onChangeSeekStep,
  onChangeSubtitleFollowPreferences,
}: PlayerControlsProps) {
  const seekStepMs = seekStepSeconds * 1_000;
  return (
    <div className="player-controls">
      <input
        className="seek-control"
        type="range"
        min="0"
        max={Math.max(durationMs ?? 0, 1)}
        step="100"
        value={Math.min(positionMs, durationMs ?? positionMs)}
        aria-label="播放进度"
        onChange={(event) => onSeekTo(Number(event.target.value))}
      />
      <div className="control-row">
        <div className="playback-buttons">
          <button
            aria-label="上一集"
            className="control-icon"
            type="button"
            title="上一集"
            disabled={!previousEpisode || switchingEpisode}
            onClick={() => previousEpisode && onSwitchEpisode(previousEpisode)}
          >
            ◀▮
          </button>
          <button
            aria-label={`快退 ${seekStepSeconds} 秒`}
            aria-keyshortcuts="ArrowLeft"
            className="control-icon seek-skip-control"
            type="button"
            title={`快退 ${seekStepSeconds} 秒（←）`}
            onClick={() => onSeekTo(positionMs - seekStepMs)}
          >
            <span aria-hidden="true">↶<small>{seekStepSeconds}</small></span>
          </button>
          <button
            aria-keyshortcuts="Space"
            className="play-button"
            type="button"
            onClick={onTogglePlayback}
          >
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
            <strong>{playing ? "暂停" : "播放"}</strong>
          </button>
          <button
            aria-label={`快进 ${seekStepSeconds} 秒`}
            aria-keyshortcuts="ArrowRight"
            className="control-icon seek-skip-control"
            type="button"
            title={`快进 ${seekStepSeconds} 秒（→）`}
            onClick={() => onSeekTo(positionMs + seekStepMs)}
          >
            <span aria-hidden="true"><small>{seekStepSeconds}</small>↷</span>
          </button>
          <button
            aria-label="下一集"
            className="control-icon"
            type="button"
            title="下一集"
            disabled={!nextEpisode || switchingEpisode}
            onClick={() => nextEpisode && onSwitchEpisode(nextEpisode)}
          >
            ▮▶
          </button>
        </div>
        <span className="player-time">
          {formatDuration(positionMs)} / {formatDuration(durationMs)}
        </span>
        <div className="volume-control">
          <button
            aria-label={muted ? "取消静音" : "静音"}
            aria-keyshortcuts="M"
            className="control-icon"
            type="button"
            title={muted ? "取消静音" : "静音"}
            onClick={onToggleMuted}
          >
            {muted ? "×))" : "◖))"}
          </button>
          <input
            aria-label="音量"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={(event) => onChangeVolume(Number(event.target.value))}
          />
        </div>
        <div className="now-playing" title={mediaTitle}>{mediaTitle}</div>
        <div className="playback-options">
          <select
            aria-label="字幕显示"
            className="caption-select"
            value={subtitleMode}
            onChange={(event) => onChangeSubtitleMode(event.target.value as SubtitleDisplayMode)}
          >
            <option value="translation" disabled={!translationAvailable}>中文字幕</option>
            <option value="original" disabled={!originalSubtitleAvailable}>原文字幕</option>
            <option value="bilingual" disabled={!originalSubtitleAvailable || !translationAvailable}>双语字幕</option>
          </select>
          <SubtitleAppearancePopover preferences={subtitleFollowPreferences} onChange={onChangeSubtitleFollowPreferences} />
          <label className="seek-step-field" title="设置快进和快退的跳转时长">
            <span>跳转</span>
            <select
              aria-label="快进快退时长"
              value={seekStepSeconds}
              onChange={(event) => onChangeSeekStep(Number(event.target.value) as SeekStepSeconds)}
            >
              {seekStepOptions.map((seconds) => (
                <option key={seconds} value={seconds}>{seconds} 秒</option>
              ))}
            </select>
          </label>
          <select
            aria-label="播放速度"
            className="speed-select"
            value={playbackRate}
            onChange={(event) => onChangePlaybackRate(Number(event.target.value))}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
              <option key={rate} value={rate}>{rate}×</option>
            ))}
          </select>
          <button
            aria-label={fullscreen ? "退出全屏" : "进入全屏"}
            aria-keyshortcuts="F"
            className="control-icon"
            type="button"
            title={fullscreen ? "退出全屏" : "全屏"}
            onClick={onToggleFullscreen}
          >
            ⛶
          </button>
        </div>
      </div>
    </div>
  );
}
