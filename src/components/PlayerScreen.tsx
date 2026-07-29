import { useCallback, useEffect, useRef, useState } from "react";

import { formatDuration, formatFileSize } from "../lib/format";
import { playbackUrl } from "../lib/desktop";
import type { MediaPreparation, Project } from "../types";

type PlaybackValues = {
  positionMs: number;
  durationMs: number | null;
  volume: number;
  playbackRate: number;
};

type PlayerScreenProps = {
  project: Project;
  preparation: MediaPreparation;
  onBack: () => void;
  onNeedProxy: (reason: string) => void;
  onPersist: (values: PlaybackValues) => Promise<void>;
  onError: (message: string) => void;
};

export function PlayerScreen({
  project,
  preparation,
  onBack,
  onNeedProxy,
  onPersist,
  onError,
}: PlayerScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const proxyRequestedRef = useRef(false);
  const lastSavedAtRef = useRef(0);
  const performanceTimerRef = useRef<number | null>(null);
  const performanceStartRef = useRef<{
    total: number;
    dropped: number;
  } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(
    project.playbackState.positionMs,
  );
  const [durationMs, setDurationMs] = useState<number | null>(
    preparation.inspection.probe.durationMs ??
      project.playbackState.durationMs,
  );
  const [volume, setVolume] = useState(project.playbackState.volume);
  const [playbackRate, setPlaybackRate] = useState(
    project.playbackState.playbackRate,
  );
  const [videoReady, setVideoReady] = useState(false);
  const persistFunctionRef = useRef<
    (video: HTMLVideoElement | null) => Promise<void>
  >(async () => undefined);
  const sourceIsProxy = preparation.playbackSourceKind === "proxy";
  const sourceUrl = playbackUrl(preparation.playbackPath);
  const videoStream = preparation.inspection.probe.videoStreams[0];
  const audioStream = preparation.inspection.probe.audioStreams[0];

  const persistCurrentState = useCallback(
    async (video: HTMLVideoElement | null) => {
      const nextPosition = video
        ? Math.max(0, Math.round(video.currentTime * 1_000))
        : positionMs;
      const mediaDuration =
        video && Number.isFinite(video.duration)
          ? Math.round(video.duration * 1_000)
          : durationMs;
      await onPersist({
        positionMs: nextPosition,
        durationMs: mediaDuration,
        volume: video?.volume ?? volume,
        playbackRate: video?.playbackRate ?? playbackRate,
      });
      lastSavedAtRef.current = Date.now();
    },
    [durationMs, onPersist, playbackRate, positionMs, volume],
  );

  const requestProxy = useCallback(
    (reason: string) => {
      if (sourceIsProxy || proxyRequestedRef.current) {
        if (sourceIsProxy) {
          onError(
            "兼容播放版本仍然没有产生有效画面。项目和源视频已保留，可以返回项目库后重新尝试。",
          );
        }
        return;
      }
      proxyRequestedRef.current = true;
      videoRef.current?.pause();
      onNeedProxy(reason);
    },
    [onError, onNeedProxy, sourceIsProxy],
  );

  useEffect(() => {
    proxyRequestedRef.current = false;
    const video = videoRef.current;
    if (!video) {
      return undefined;
    }
    video.volume = volume;
    video.playbackRate = playbackRate;

    const timer = window.setTimeout(() => {
      if (
        !sourceIsProxy &&
        (!video.videoWidth || !video.videoHeight || video.readyState < 2)
      ) {
        requestProxy("video_frame_timeout");
      }
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [playbackRate, requestProxy, sourceIsProxy, sourceUrl, volume]);

  useEffect(() => {
    persistFunctionRef.current = persistCurrentState;
  }, [persistCurrentState]);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (performanceTimerRef.current !== null) {
        window.clearTimeout(performanceTimerRef.current);
      }
      void persistFunctionRef.current(video).catch(() => undefined);
    };
  }, []);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.volume = volume;
    video.playbackRate = playbackRate;
    if (Number.isFinite(video.duration)) {
      const nextDuration = Math.round(video.duration * 1_000);
      setDurationMs(nextDuration);
      const restoreSeconds = Math.min(
        project.playbackState.positionMs / 1_000,
        Math.max(0, video.duration - 0.25),
      );
      if (restoreSeconds > 0) {
        video.currentTime = restoreSeconds;
      }
    }
  };

  const handleLoadedData = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoReady(true);
      return;
    }
    requestProxy("zero_video_dimensions");
  };

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      try {
        await video.play();
      } catch (error) {
        onError(
          error instanceof Error ? error.message : "播放器未能开始播放",
        );
      }
    } else {
      video.pause();
    }
  }, [onError]);

  const seekTo = useCallback((nextPositionMs: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const bounded = Math.max(
      0,
      Math.min(nextPositionMs, durationMs ?? nextPositionMs),
    );
    video.currentTime = bounded / 1_000;
    setPositionMs(bounded);
  }, [durationMs]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, select, textarea, button, a, [contenteditable='true']",
        )
      ) {
        return;
      }
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        void togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekTo(positionMs - 10_000);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekTo(positionMs + 10_000);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [onBack, positionMs, seekTo, togglePlayback]);

  const beginPerformanceCheck = () => {
    const video = videoRef.current;
    if (
      !video ||
      sourceIsProxy ||
      preparation.inspection.playbackGate.decision !==
        "runtime_validation_required" ||
      typeof video.getVideoPlaybackQuality !== "function"
    ) {
      return;
    }
    const start = video.getVideoPlaybackQuality();
    performanceStartRef.current = {
      total: start.totalVideoFrames,
      dropped: start.droppedVideoFrames,
    };
    if (performanceTimerRef.current !== null) {
      window.clearTimeout(performanceTimerRef.current);
    }
    performanceTimerRef.current = window.setTimeout(() => {
      const baseline = performanceStartRef.current;
      const currentVideo = videoRef.current;
      if (!baseline || !currentVideo) {
        return;
      }
      const quality = currentVideo.getVideoPlaybackQuality();
      const total = quality.totalVideoFrames - baseline.total;
      const dropped = quality.droppedVideoFrames - baseline.dropped;
      if (total >= 30 && dropped / total > 0.15) {
        requestProxy("runtime_dropped_frames");
      }
    }, 4_000);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const nextPosition = Math.round(video.currentTime * 1_000);
    setPositionMs(nextPosition);
    if (Date.now() - lastSavedAtRef.current > 5_000) {
      void persistCurrentState(video).catch(() => undefined);
    }
  };

  const changeVolume = (nextVolume: number) => {
    const video = videoRef.current;
    if (video) {
      video.volume = nextVolume;
    }
    setVolume(nextVolume);
  };

  const changePlaybackRate = (nextRate: number) => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = nextRate;
    }
    setPlaybackRate(nextRate);
  };

  return (
    <div className="player-screen" data-screen-label="本地播放器">
      <header className="player-toolbar">
        <div className="player-toolbar-start">
          <button className="button quiet small" type="button" onClick={onBack}>
            返回
          </button>
          <div className="player-title">
            <strong>{project.title}</strong>
            <small>
              {sourceIsProxy ? "兼容播放版本" : "正在播放原片"} ·{" "}
              {videoStream?.codecName.toUpperCase() ?? "视频"}
              {audioStream
                ? ` / ${audioStream.codecName.toUpperCase()}`
                : " / 无音轨"}
            </small>
          </div>
        </div>
        <div className="player-mode">
          <span className="active">观影</span>
          <span title="将在后续阶段接入">理解</span>
          <span title="将在后续阶段接入">学习</span>
        </div>
        <div className="player-toolbar-end">
          <span className={`status-pill ${videoReady ? "ready" : "warning"}`}>
            {videoReady ? "画面已确认" : "正在确认画面"}
          </span>
          <button
            className="button quiet small"
            type="button"
            onClick={() => void document.documentElement.requestFullscreen()}
          >
            全屏
          </button>
        </div>
      </header>

      <main className="video-stage">
        <video
          ref={videoRef}
          key={sourceUrl}
          src={sourceUrl}
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={handleLoadedData}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => {
            setPlaying(true);
            beginPerformanceCheck();
          }}
          onPause={() => {
            setPlaying(false);
            void persistCurrentState(videoRef.current).catch(() => undefined);
          }}
          onEnded={() => {
            setPlaying(false);
            void persistCurrentState(videoRef.current).catch(() => undefined);
          }}
          onError={() => requestProxy("media_element_error")}
        ></video>

        {!videoReady ? (
          <div className="video-loading" aria-live="polite">
            <span className="spinner large"></span>
            <strong>正在确认视频画面</strong>
            <span>只有检测到有效视频尺寸后才会进入观看状态。</span>
          </div>
        ) : null}

        <div className="media-pills">
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

        <div className="player-controls">
          <input
            className="seek-control"
            type="range"
            min="0"
            max={Math.max(durationMs ?? 0, 1)}
            step="100"
            value={Math.min(positionMs, durationMs ?? positionMs)}
            aria-label="播放进度"
            onChange={(event) => seekTo(Number(event.target.value))}
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
                {formatDuration(positionMs)} / {formatDuration(durationMs)}
              </span>
            </div>
            <div className="playback-options">
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
    </div>
  );
}
