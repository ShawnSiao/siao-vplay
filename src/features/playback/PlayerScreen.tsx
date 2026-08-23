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
import { PlayerCaptionStack } from "./PlayerCaptionStack";
import { PlayerDrawer } from "./PlayerDrawer";
import { PlayerErrorCard } from "./PlayerErrorCard";
import { EpisodeDrawer } from "./EpisodeDrawer";
import type { EpisodeNavigationState } from "../library/useEpisodeNavigation";
import { PlayerControls } from "./PlayerControls";
import { useFullscreenControlVisibility } from "./useFullscreenControlVisibility";
import {
  useSeekStepPreference,
  useSubtitleFollowPreferences,
} from "./playbackPreferences";
import "./player-feedback.css";
import "./player-fullscreen.css";
import { useSummaryCompletionNotice } from "../summary/useSummaryCompletionNotice";
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
  onNotice: (message: string) => void;
  onRetryPlayback: () => void;
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
  onNotice,
  onRetryPlayback,
}: PlayerScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [switchingEpisode, setSwitchingEpisode] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  useSummaryCompletionNotice(project.id, onNotice);
  const { seekStepSeconds, changeSeekStep } = useSeekStepPreference();
  const {
    subtitleFollowPreferences,
    changeSubtitleFollowPreferences,
  } = useSubtitleFollowPreferences();
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
    pausePlayback,
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
    seekStepMs: seekStepSeconds * 1_000,
    onBack,
    onCloseDrawer,
    onCloseContextMenu,
    onNeedProxy,
    onPersist,
    onError: onNotice,
    onFatalError: setPlayerError,
  });
  const { controlsVisible, revealControls } =
    useFullscreenControlVisibility(fullscreen);
  const currentEpisode = episodeNavigation.episodes.find(
    (episode) => episode.projectId === project.id,
  );
  const drawerContextLabel =
    currentEpisode?.seasonNumber !== null &&
    currentEpisode?.seasonNumber !== undefined &&
    currentEpisode?.episodeNumber !== null &&
    currentEpisode?.episodeNumber !== undefined
      ? `第 ${currentEpisode.seasonNumber} 季 · 第 ${currentEpisode.episodeNumber} 集`
      : "当前视频";
  const drawerEpisodeSummary = episodeNavigation.detail
    ? `${episodeNavigation.detail.summary.itemCount} 集 · ${
        positionMs > 0 ? `看到 ${formatDuration(positionMs)}` : "未观看"
      }`
    : "当前视频";
  const drawerContextStatus =
    currentSubtitle || currentTranslation ? "字幕已同步" : "等待字幕";
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
      className={`player-screen ${fullscreen ? "fullscreen-player" : ""} ${
        fullscreen && !controlsVisible ? "controls-hidden" : ""
      }`.trim()}
      data-screen-label="本地播放器"
      onPointerMove={revealControls}
      onKeyDownCapture={revealControls}
      onFocusCapture={revealControls}
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

            <PlayerCaptionStack
              mode={effectiveSubtitleMode}
              original={activeOriginal}
              translation={activeTranslation}
              originalLanguage={currentSubtitle?.languageCode}
              videoRef={videoRef}
              stageRef={stageRef}
              playing={playing}
              positionMs={positionMs}
              fullscreen={fullscreen}
              preferences={subtitleFollowPreferences}
              onPositionCommit={(position) =>
                changeSubtitleFollowPreferences({
                  ...subtitleFollowPreferences,
                  position,
                })
              }
              onTogglePlayback={() => void togglePlayback()}
            />

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

            {playerError ? (
              <PlayerErrorCard
                message={playerError}
                onDismiss={() => setPlayerError(null)}
                onRetry={() => {
                  setPlayerError(null);
                  onRetryPlayback();
                }}
              />
            ) : null}
          </div>

          <PlayerControls
            playing={playing}
            muted={muted}
            fullscreen={fullscreen}
            positionMs={positionMs}
            durationMs={durationMs}
            volume={volume}
            playbackRate={playbackRate}
            subtitleMode={effectiveSubtitleMode}
            originalSubtitleAvailable={Boolean(currentSubtitle)}
            translationAvailable={Boolean(currentTranslation)}
            mediaTitle={project.title}
            previousEpisode={episodeNavigation.neighbors.previous}
            nextEpisode={episodeNavigation.neighbors.next}
            switchingEpisode={switchingEpisode}
            seekStepSeconds={seekStepSeconds}
            subtitleFollowPreferences={subtitleFollowPreferences}
            onSwitchEpisode={(episode) => void switchEpisode(episode)}
            onTogglePlayback={() => void togglePlayback()}
            onToggleMuted={toggleMuted}
            onToggleFullscreen={() => void toggleFullscreen()}
            onSeekTo={seekTo}
            onChangeVolume={changeVolume}
            onChangePlaybackRate={changePlaybackRate}
            onChangeSubtitleMode={changeSubtitleMode}
            onChangeSeekStep={changeSeekStep}
            onChangeSubtitleFollowPreferences={changeSubtitleFollowPreferences}
          />
        </main>

        {drawerTab ? (
          <PlayerDrawer
            activeTab={drawerTab}
            mediaTitle={project.title}
            contextLabel={drawerContextLabel}
            contextStatus={drawerContextStatus}
            episodeSummary={drawerEpisodeSummary}
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
                playbackPositionMs={positionMs}
                playbackDurationMs={durationMs}
                onSwitch={(episode) => void switchEpisode(episode)}
              />
            ) : drawerTab === "understand" ? (
              <UnderstandingPanel
                embedded
                key={project.id}
                projectId={project.id}
                playbackCutoffMs={positionMs}
                durationMs={durationMs}
                sourceVersion={currentSubtitle}
                translationVersion={currentTranslation}
                onPrepareSubtitles={onManageSubtitles}
                onClose={onCloseDrawer}
                onJump={seekTo}
                onPausePlayback={pausePlayback}
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
                onPausePlayback={pausePlayback}
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
