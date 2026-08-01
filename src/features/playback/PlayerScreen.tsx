import { formatDuration, formatFileSize } from "../../lib/format";
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

type PlayerScreenProps = {
  project: Project;
  preparation: MediaPreparation;
  currentSubtitle: SubtitleVersion | null;
  currentTranslation: SubtitleVersion | null;
  drawerTab: ShellDrawerTab | null;
  contextMenu: ShellContextMenu | null;
  onBack: () => void;
  onCloseDrawer: () => void;
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
  onOpenContextMenu,
  onCloseContextMenu,
  onManageSubtitles,
  onNeedProxy,
  onPersist,
  onError,
}: PlayerScreenProps) {
  const {
    playerRef,
    videoRef,
    sourceUrl,
    videoStream,
    audioStream,
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

            <div className="media-pills">
              <span>
                {videoStream?.codecName.toUpperCase() ?? "视频"} /{" "}
                {audioStream?.codecName.toUpperCase() ?? "无音轨"}
              </span>
              <span>
                {videoStream
                  ? `${videoStream.width} × ${videoStream.height}`
                  : "分辨率未知"}
              </span>
              <span>
                {formatFileSize(preparation.inspection.probe.sizeBytes)}
              </span>
              {preparation.reusedProxy ? <span>已复用播放版本</span> : null}
            </div>

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
                  aria-keyshortcuts="ArrowLeft"
                  className="control-button"
                  type="button"
                  onClick={() => seekTo(positionMs - 10_000)}
                >
                  −10
                </button>
                <button
                  aria-keyshortcuts="Space"
                  className="control-button play"
                  type="button"
                  onClick={() => void togglePlayback()}
                >
                  {playing ? "暂停" : "播放"}
                </button>
                <button
                  aria-keyshortcuts="ArrowRight"
                  className="control-button"
                  type="button"
                  onClick={() => seekTo(positionMs + 10_000)}
                >
                  +10
                </button>
                <span className="player-time">
                  {formatDuration(positionMs)} /{" "}
                  {formatDuration(durationMs)}
                </span>
              </div>
              <div className="playback-options">
                <div className="caption-mode" aria-label="字幕显示">
                  {(
                    [
                      ["translation", "中文", Boolean(currentTranslation)],
                      ["original", "原文", Boolean(currentSubtitle)],
                      [
                        "bilingual",
                        "双语",
                        Boolean(currentSubtitle && currentTranslation),
                      ],
                    ] as const
                  ).map(([mode, label, available]) => (
                    <button
                      aria-label={`显示${label}字幕`}
                      className={
                        effectiveSubtitleMode === mode ? "active" : ""
                      }
                      disabled={!available}
                      key={mode}
                      type="button"
                      onClick={() => changeSubtitleMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label>
                  <span>音量</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={(event) =>
                      changeVolume(Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  <span>速度</span>
                  <select
                    value={playbackRate}
                    onChange={(event) =>
                      changePlaybackRate(Number(event.target.value))
                    }
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <option key={rate} value={rate}>
                        {rate}×
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        </main>

        {drawerTab === "episodes" ? (
          <aside className="player-drawer episode-drawer" aria-label="剧集抽屉">
            <header className="player-drawer-header">
              <div>
                <span>剧集</span>
                <strong>当前视频</strong>
              </div>
              <button
                aria-label="关闭剧集抽屉"
                type="button"
                onClick={onCloseDrawer}
              >
                ×
              </button>
            </header>
            <div className="player-drawer-empty">
              <strong>尚未加入剧集</strong>
              <p>剧集列表会在 Phase 7C 接入真实集合数据。</p>
            </div>
          </aside>
        ) : drawerTab === "understand" ? (
          <UnderstandingPanel
            key={project.id}
            projectId={project.id}
            playbackCutoffMs={positionMs}
            sourceVersion={currentSubtitle}
            translationVersion={currentTranslation}
            onPrepareSubtitles={onManageSubtitles}
            onClose={onCloseDrawer}
          />
        ) : drawerTab === "learn" ? (
          <LearningPanel
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
        ) : null}
      </div>

      {contextMenu ? (
        <div
          className="player-context-menu"
          role="menu"
          aria-label="播放器右键菜单"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              onCloseContextMenu();
              void togglePlayback();
            }}
          >
            {playing ? "暂停" : "播放"}
            <span>Space</span>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              onCloseContextMenu();
              toggleMuted();
            }}
          >
            {muted ? "取消静音" : "静音"}
            <span>M</span>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              onCloseContextMenu();
              void toggleFullscreen();
            }}
          >
            {fullscreen ? "退出全屏" : "全屏"}
            <span>F</span>
          </button>
          <span className="context-menu-divider" />
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              onCloseContextMenu();
              onManageSubtitles();
            }}
          >
            字幕设置
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              onCloseContextMenu();
              onBack();
            }}
          >
            返回媒体库
          </button>
        </div>
      ) : null}
    </div>
  );
}
