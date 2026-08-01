import { useCallback, useEffect, useRef, useState } from "react";

import { playbackUrl } from "../../lib/desktop";
import type {
  MediaPreparation,
  Project,
  SubtitleDisplayMode,
  SubtitleSegment,
  SubtitleVersion,
} from "../../types";
import type {
  ShellContextMenu,
  ShellDrawerTab,
} from "../shell/useShellController";

export type PlaybackValues = {
  positionMs: number;
  durationMs: number | null;
  volume: number;
  playbackRate: number;
  subtitleMode: SubtitleDisplayMode;
};

type PlaybackControllerOptions = {
  project: Project;
  preparation: MediaPreparation;
  currentSubtitle: SubtitleVersion | null;
  currentTranslation: SubtitleVersion | null;
  drawerTab: ShellDrawerTab | null;
  contextMenu: ShellContextMenu | null;
  onBack: () => void;
  onCloseDrawer: () => void;
  onCloseContextMenu: () => void;
  onNeedProxy: (reason: string) => void;
  onPersist: (values: PlaybackValues) => Promise<void>;
  onError: (message: string) => void;
};

function activeSegment(
  version: SubtitleVersion | null,
  positionMs: number,
): SubtitleSegment | null {
  return (
    version?.segments.find(
      (segment) => positionMs >= segment.startMs && positionMs < segment.endMs,
    ) ?? null
  );
}

export function usePlaybackController({
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
}: PlaybackControllerOptions) {
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const proxyRequestedRef = useRef(false);
  const lastSavedAtRef = useRef(0);
  const performanceTimerRef = useRef<number | null>(null);
  const performanceStartRef = useRef<{ total: number; dropped: number } | null>(
    null,
  );
  const surfaceClickTimerRef = useRef<number | null>(null);
  const persistFunctionRef = useRef<
    (video: HTMLVideoElement | null) => Promise<void>
  >(async () => undefined);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [positionMs, setPositionMs] = useState(
    project.playbackState.positionMs,
  );
  const [durationMs, setDurationMs] = useState<number | null>(
    preparation.inspection.probe.durationMs ?? project.playbackState.durationMs,
  );
  const [volume, setVolume] = useState(project.playbackState.volume);
  const [playbackRate, setPlaybackRate] = useState(
    project.playbackState.playbackRate,
  );
  const [subtitleMode, setSubtitleMode] = useState<SubtitleDisplayMode>(
    project.playbackState.subtitleMode,
  );
  const [videoReady, setVideoReady] = useState(false);
  const sourceIsProxy = preparation.playbackSourceKind === "proxy";
  const sourceUrl = playbackUrl(preparation.playbackPath);
  const videoStream = preparation.inspection.probe.videoStreams[0];
  const audioStream = preparation.inspection.probe.audioStreams[0];

  const persistCurrentState = useCallback(
    async (video: HTMLVideoElement | null, nextSubtitleMode = subtitleMode) => {
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
        subtitleMode: nextSubtitleMode,
      });
      lastSavedAtRef.current = Date.now();
    },
    [durationMs, onPersist, playbackRate, positionMs, subtitleMode, volume],
  );

  const requestProxy = useCallback(
    (reason: string) => {
      if (sourceIsProxy || proxyRequestedRef.current) {
        if (sourceIsProxy) {
          onError(
            "兼容播放版本仍然没有产生有效画面。项目和源视频已保留，可以返回媒体库后重新尝试。",
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
      if (surfaceClickTimerRef.current !== null) {
        window.clearTimeout(surfaceClickTimerRef.current);
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
        setPlaying(true);
      } catch (error) {
        onError(error instanceof Error ? error.message : "播放器未能开始播放");
      }
    } else {
      video.pause();
      setPlaying(false);
    }
  }, [onError]);

  const toggleMuted = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await playerRef.current?.requestFullscreen();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "无法切换全屏");
    }
  }, [onError]);

  const handleSurfaceClick = () => {
    if (surfaceClickTimerRef.current !== null) {
      window.clearTimeout(surfaceClickTimerRef.current);
    }
    surfaceClickTimerRef.current = window.setTimeout(() => {
      surfaceClickTimerRef.current = null;
      void togglePlayback();
    }, 180);
  };

  const handleSurfaceDoubleClick = () => {
    if (surfaceClickTimerRef.current !== null) {
      window.clearTimeout(surfaceClickTimerRef.current);
      surfaceClickTimerRef.current = null;
    }
    void toggleFullscreen();
  };

  const seekTo = useCallback(
    (nextPositionMs: number) => {
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
    },
    [durationMs],
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const closeMenu = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".player-context-menu")
      ) {
        return;
      }
      onCloseContextMenu();
    };
    window.addEventListener("pointerdown", closeMenu);
    return () => window.removeEventListener("pointerdown", closeMenu);
  }, [contextMenu, onCloseContextMenu]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (contextMenu) {
          onCloseContextMenu();
        } else if (drawerTab) {
          onCloseDrawer();
        } else if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          onBack();
        }
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, select, textarea, button, a, [contenteditable='true']",
        )
      ) {
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) {
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
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleMuted();
      } else if (event.key === "[") {
        event.preventDefault();
        const nextRate = Math.max(0.5, playbackRate - 0.25);
        if (videoRef.current) {
          videoRef.current.playbackRate = nextRate;
        }
        setPlaybackRate(nextRate);
      } else if (event.key === "]") {
        event.preventDefault();
        const nextRate = Math.min(2, playbackRate + 0.25);
        if (videoRef.current) {
          videoRef.current.playbackRate = nextRate;
        }
        setPlaybackRate(nextRate);
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [
    contextMenu,
    drawerTab,
    onBack,
    onCloseContextMenu,
    onCloseDrawer,
    playbackRate,
    positionMs,
    seekTo,
    toggleFullscreen,
    toggleMuted,
    togglePlayback,
  ]);

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

  const handlePlay = () => {
    setPlaying(true);
    beginPerformanceCheck();
  };
  const handlePause = () => {
    setPlaying(false);
    void persistCurrentState(videoRef.current).catch(() => undefined);
  };
  const handleEnded = () => {
    setPlaying(false);
    void persistCurrentState(videoRef.current).catch(() => undefined);
  };
  const changeVolume = (nextVolume: number) => {
    if (videoRef.current) {
      videoRef.current.volume = nextVolume;
    }
    setVolume(nextVolume);
  };
  const changePlaybackRate = (nextRate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
    }
    setPlaybackRate(nextRate);
  };
  const changeSubtitleMode = (nextMode: SubtitleDisplayMode) => {
    setSubtitleMode(nextMode);
    void persistCurrentState(videoRef.current, nextMode).catch(() => undefined);
  };

  const activeOriginal = activeSegment(currentSubtitle, positionMs);
  const activeTranslation = activeSegment(currentTranslation, positionMs);
  const effectiveSubtitleMode: SubtitleDisplayMode =
    subtitleMode === "bilingual"
      ? currentSubtitle && currentTranslation
        ? "bilingual"
        : currentTranslation
          ? "translation"
          : "original"
      : subtitleMode === "translation" && !currentTranslation && currentSubtitle
        ? "original"
        : subtitleMode === "original" && !currentSubtitle && currentTranslation
          ? "translation"
          : subtitleMode;

  return {
    playerRef,
    videoRef,
    sourceUrl,
    sourceIsProxy,
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
  };
}
