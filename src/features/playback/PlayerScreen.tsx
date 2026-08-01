import { useRef } from "react";

import { formatDuration } from "../../lib/format";
import type { MediaPreparation, Project, SubtitleVersion } from "../../types";
import { LearningPanel } from "../../components/LearningPanel";
import { UnderstandingPanel } from "../../components/UnderstandingPanel";
import type {
  ShellContextMenu,
  ShellDrawerTab,
} from "../shell/useShellController";
import {
  usePlaybackController,
  type PlaybackValues,
} from "./usePlaybackController";
import { PlayerContextMenu } from "./PlayerContextMenu";
import { PlayerDrawer } from "./PlayerDrawer";

type PlayerScreenProps = {
  project: Project;
  preparation: MediaPreparation;
  currentSubtitle: SubtitleVersion | null;
  currentTranslation: SubtitleVersion | null;
  drawerTab: ShellDrawerTab | null;
  contextMenu: ShellContextMenu | null;
  onBack: () => void;
  onCloseDrawer: () => void;
  onSelectDrawer: (tab: ShellDrawerTab) => void;
  onOpenContextMenu: (position: ShellContextMenu) => void;
  onCloseContextMenu: () => void;
  onManageSubtitles: () => void;
  onNeedProxy: (reason: string) => void;
  onPersist: (values: PlaybackValues) => Promise<void>;
  onError: (message: string) => void;
};

export function PlayerScreen({
  project,
  preparation,
  currentSubtitle,
  currentTranslation,
  drawerTab,
  contextMenu,
  onBack,
  onCloseDrawer,
  onSelectDrawer,
  onOpenContextMenu,
  onCloseContextMenu,
  onManageSubtitles,
  onNeedProxy,
  onPersist,
  onError,
}: PlayerScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const {
    playerRef,
    videoRef,
    sourceUrl,
    playing,
    muted,
    fullscreen,
    positionMs,
    durationMs,
    volume,
    playbackRate,
    videoReady,
    activeOriginal,
    activeTranslation,
    effectiveSubtitleMode,
    requestProxy,
    handleLoadedMetadata,
    handleLoadedData,
    handleTimeUpdate,
    handlePlay,
    handlePause,
    handleEnded,
    handleSurfaceClick,
    handleSurfaceDoubleClick,
    togglePlayback,
    toggleMuted,
    toggleFullscreen,
    seekTo,
    changeVolume,
    changePlaybackRate,
    changeSubtitleMode,
  } = usePlaybackController({
    project,
    preparation,
    currentSubtitle,
    currentTranslation,
    drawerTab,
    contextMenu,
    onBack,
    onCloseDrawer,
    onCloseContextMenu,
    onNeedProxy,
    onPersist,
    onError,
  });

  return (
    <div
      ref={playerRef}
      className="player-screen"
      data-screen-label="本地播放器"
    >
      <div
        className={`player-workspace ${drawerTab ? "with-drawer" : ""}`}
      >
        <main className="player-primary">
          <div
            ref={stageRef}
            className="video-stage"
            tabIndex={0}
            onContextMenu={(event) => {
              event.preventDefault();
              const clientX = Number.isFinite(event.clientX)
                ? event.clientX
                : 0;
              const clientY = Number.isFinite(event.clientY)
                ? event.clientY
                : 0;
              onOpenContextMenu({
                x: Math.max(0, Math.min(clientX, window.innerWidth - 210)),
                y: Math.max(0, Math.min(clientY, window.innerHeight - 220)),
              });
            }}
          >
            <video
              ref={videoRef}
              key={sourceUrl}
              src={sourceUrl || undefined}
              preload="metadata"
              aria-label="视频画面，单击播放或暂停"
              aria-keyshortcuts="Space F M [ ]"
              onClick={handleSurfaceClick}
              onDoubleClick={handleSurfaceDoubleClick}
              onLoadedMetadata={handleLoadedMetadata}
              onLoadedData={handleLoadedData}
              onTimeUpdate={handleTimeUpdate}
              onPlay={handlePlay}
              onPause={handlePause}
              onEnded={handleEnded}
              onError={() => requestProxy("media_element_error")}
            />

            {!videoReady ? (
              <div className="video-loading" aria-live="polite">
                <span className="spinner large" />
                <strong>正在确认视频画面</strong>
                <span>只有检测到有效视频尺寸后才会进入观看状态。</span>
              </div>
            ) : null}

            {activeOriginal || activeTranslation ? (
              <div className="caption-stack" aria-live="off">
                {(effectiveSubtitleMode === "original" ||
                  effectiveSubtitleMode === "bilingual") &&
                activeOriginal ? (
                  <p
                    className="caption-line original"
                    lang={currentSubtitle?.languageCode}
                  >
                    {activeOriginal.text}
                  </p>
                ) : null}
                {(effectiveSubtitleMode === "translation" ||
                  effectiveSubtitleMode === "bilingual") &&
                activeTranslation ? (
                  <p className="caption-line translation" lang="zh-CN">
                    {activeTranslation.text}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="player-controls">
            <input
              className="seek-control"
              type="range"
              min="0"
              max={Math.max(durationMs ?? 0, 1)}
              step="100"
              value={Math.min(
                positionMs,
                durationMs ?? positionMs,
              )}
              aria-label="播放进度"
              onChange={(event) =>
                seekTo(Number(event.target.value))
              }
            />
            <div className="control-row">
              <div className="playback-buttons">
                <button
                  aria-label="上一集，将在剧集功能接通后启用"
                  className="control-icon"
                  type="button"
                  title="上一集 · Phase 7D 启用"
                  disabled
                >
                  ◀▮
                </button>
                <button
                  aria-keyshortcuts="Space"
                  className="play-button"
                  type="button"
                  onClick={() => void togglePlayback()}
                >
                  <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
                  <strong>{playing ? "暂停" : "播放"}</strong>
                </button>
                <button
                  aria-label="下一集，将在剧集功能接通后启用"
                  className="control-icon"
                  type="button"
                  title="下一集 · Phase 7D 启用"
                  disabled
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
                  onClick={toggleMuted}
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
                  onChange={(event) => changeVolume(Number(event.target.value))}
                />
              </div>
              <div className="now-playing" title={project.title}>
                {project.title}
              </div>
              <div className="playback-options">
                <select
                  aria-label="字幕显示"
                  className="caption-select"
                  value={effectiveSubtitleMode}
                  onChange={(event) =>
                    changeSubtitleMode(
                      event.target.value as "translation" | "original" | "bilingual",
                    )
                  }
                >
                  <option value="translation" disabled={!currentTranslation}>中文字幕</option>
                  <option value="original" disabled={!currentSubtitle}>原文字幕</option>
                  <option
                    value="bilingual"
                    disabled={!currentSubtitle || !currentTranslation}
                  >
                    双语字幕
                  </option>
                </select>
                <select
                  aria-label="播放速度"
                  className="speed-select"
                  value={playbackRate}
                  onChange={(event) => changePlaybackRate(Number(event.target.value))}
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
                  onClick={() => void toggleFullscreen()}
                >
                  ⛶
                </button>
              </div>
            </div>
          </div>
        </main>

        {drawerTab ? (
          <PlayerDrawer
            activeTab={drawerTab}
            mediaTitle={project.title}
            onSelectTab={onSelectDrawer}
            onClose={onCloseDrawer}
          >
            {drawerTab === "episodes" ? (
              <div className="player-drawer-empty">
                <strong>尚未加入剧集</strong>
                <p>剧集列表会在 Phase 7C 接入真实集合数据。</p>
              </div>
            ) : drawerTab === "understand" ? (
              <UnderstandingPanel
                embedded
                key={project.id}
                projectId={project.id}
                playbackCutoffMs={positionMs}
                sourceVersion={currentSubtitle}
                translationVersion={currentTranslation}
                onPrepareSubtitles={onManageSubtitles}
                onClose={onCloseDrawer}
              />
            ) : (
              <LearningPanel
                embedded
                key={`${project.id}:${activeOriginal?.id ?? "no-line"}`}
                projectId={project.id}
                playbackPositionMs={positionMs}
                sourceVersion={currentSubtitle}
                translationVersion={currentTranslation}
                sourceSegment={activeOriginal}
                translationSegment={activeTranslation}
                onPrepareSubtitles={onManageSubtitles}
                onClose={onCloseDrawer}
                onJump={seekTo}
              />
            )}
          </PlayerDrawer>
        ) : null}
      </div>

      {contextMenu ? (
        <PlayerContextMenu
          position={contextMenu}
          playing={playing}
          muted={muted}
          fullscreen={fullscreen}
          returnFocusRef={stageRef}
          onClose={onCloseContextMenu}
          onTogglePlayback={() => void togglePlayback()}
          onToggleMuted={toggleMuted}
          onToggleFullscreen={() => void toggleFullscreen()}
          onManageSubtitles={onManageSubtitles}
          onBack={onBack}
        />
      ) : null}
    </div>
  );
}
