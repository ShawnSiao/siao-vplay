import { useEffect, useState, type RefObject } from "react";

type VideoFrameCallbackApi = {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function useMediaPlaybackClock(
  videoRef: RefObject<HTMLVideoElement | null>,
  playing: boolean,
  fallbackPositionMs: number,
) {
  const [positionMs, setPositionMs] = useState(fallbackPositionMs);

  useEffect(() => {
    if (!playing) return;
    const video = videoRef.current;
    if (!video) return;
    const frameApi = video as unknown as Partial<VideoFrameCallbackApi>;
    let cancelled = false;
    let handle = 0;
    const update = (_now?: number, metadata?: { mediaTime: number }) => {
      if (cancelled) return;
      const seconds = metadata?.mediaTime ?? video.currentTime;
      if (Number.isFinite(seconds)) setPositionMs(seconds * 1_000);
      handle = frameApi.requestVideoFrameCallback
        ? frameApi.requestVideoFrameCallback(update)
        : window.requestAnimationFrame(update);
    };
    update();
    return () => {
      cancelled = true;
      if (frameApi.cancelVideoFrameCallback && frameApi.requestVideoFrameCallback) {
        frameApi.cancelVideoFrameCallback(handle);
      } else {
        window.cancelAnimationFrame(handle);
      }
    };
  }, [fallbackPositionMs, playing, videoRef]);

  return playing ? positionMs : fallbackPositionMs;
}
