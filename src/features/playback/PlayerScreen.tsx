import { useCallback, useRef, useState } from "react";

import { formatDuration } from "../../lib/format";
import type {
  EpisodeReference,
  MediaPreparation,
  Project,
  SubtitleVersion,
} from "../../types";
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
import { EpisodeDrawer } from "./EpisodeDrawer";
import type { EpisodeNavigationState } from "../library/useEpisodeNavigation";

type PlayerScreenProps = {
  project: Project;
  preparation: MediaPreparation;
  currentSubtitle: SubtitleVersion | null;
  currentTranslation: SubtitleVersion | null;
  drawerTab: ShellDrawerTab | null;
  contextMenu: ShellContextMenu | null;
  episodeNavigation: EpisodeNavigationState;
  onBack: () => void;
  onCloseDrawer: () => void;
  onSelectDrawer: (tab: ShellDrawerTab) => void;
  onOpenContextMenu: (position: ShellContextMenu) => void;
  onCloseContextMenu: () => void;
  onManageSubtitles: () => void;
  onNeedProxy: (reason: string) => void;
  onPersist: (values: PlaybackValues) => Promise<void>;
  onSwitchEpisode: (episode: EpisodeReference) => Promise<void>;
  onError: (message: string) => void;
};

export function PlayerScreen({
  project,
  preparation,
  currentSubtitle,
  currentTranslation,
  drawerTab,
  contextMenu,
  episodeNavigation,
  onBack,
  onCloseDrawer,
  onSelectDrawer,
  onOpenContextMenu,
  onCloseContextMenu,
  onManageSubtitles,
  onNeedProxy,
  onPersist,
  onSwitchEpisode,
  onError,
}: PlayerScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [switchingEpisode, setSwitchingEpisode] = useState(false);
  const {
    playerRef,
    videoRef,
    sourceUrl,
    playing,
    ended,
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
    persistBeforeSourceChange,
    resumeUnmountPersist,
    markCurrentStatePersistedForSourceChange,
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
  const switchEpisode = useCallback(
    async (episode: EpisodeReference, currentStateAlreadyPersisted = false) => {
      if (switchingEpisode || episode.projectId === project.id) {
        return;
      }
      setSwitchingEpisode(true);
      try {
        if (!currentStateAlreadyPersisted) {
          await persistBeforeSourceChange();
        }
        await onSwitchEpisode(episode);
      } catch {
        resumeUnmountPersist();
        setSwitchingEpisode(false);
      }
    }, [onSwitchEpisode, persistBeforeSourceChange, project.id, resumeUnmountPersist, switchingEpisode],
  );

  const handlePlaybackEnded = useCallback(() => {
    const endedStateSaved = handleEnded();
    const next = episodeNavigation.neighbors.next;
    if (
      episodeNavigation.detail?.summary.autoPlayNext &&
      next &&
      !switchingEpisode
    ) {
      void endedStateSaved
        .then(async () => {
          markCurrentStatePersistedForSourceChange();
          await switchEpisode(next, true);
        })
        .catch(() => resumeUnmountPersist());
    } else {
      void endedStateSaved.catch(() => undefined);
    }
  }, [episodeNavigation.detail, episodeNavigation.neighbors.next, handleEnded, markCurrentStatePersistedForSourceChange, resumeUnmountPersist, switchEpisode, switchingEpisode]);

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
              onEnded={handlePlaybackEnded}
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

            {ended &&
            episodeNavigation.neighbors.next &&
            !episodeNavigation.detail?.summary.autoPlayNext ? (
              <div className="next-episode-overlay" role="status">
                <span>本集播放完毕</span>
                <strong>{episodeNavigation.neighbors.next.displayTitle}</strong>
                <button
                  className="button primary"
                  type="button"
                  disabled={switchingEpisode}
                  onClick={() => void switchEpisode(episodeNavigation.neighbors.next!)}
                >
                  {switchingEpisode ? "正在打开…" : "播放下一集"}
                </button>
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
                  aria-label="上一集"
                  className="control-icon"
                  type="button"
                  title="上一集"
                  disabled={!episodeNavigation.neighbors.previous || switchingEpisode}
                  onClick={() =>
                    episodeNavigation.neighbors.previous &&
                    void switchEpisode(episodeNavigation.neighbors.previous)
                  }
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
                  aria-label="下一集"
                  className="control-icon"
                  type="button"
                  title="下一集"
                  disabled={!episodeNavigation.neighbors.next || switchingEpisode}
                  onClick={() =>
                    episodeNavigation.neighbors.next &&
                    void switchEpisode(episodeNavigation.neighbors.next)
                  }
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
              <EpisodeDrawer
                projectId={project.id}
                detail={episodeNavigation.detail}
                episodes={episodeNavigation.episodes}
                neighbors={episodeNavigation.neighbors}
                loading={episodeNavigation.loading}
                error={episodeNavigation.error}
                switching={switchingEpisode}
                onSwitch={(episode) => void switchEpisode(episode)}
              />
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
