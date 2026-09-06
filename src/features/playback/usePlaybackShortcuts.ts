import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

type PlaybackShortcutOptions = {
  contextMenuOpen: boolean;
  drawerOpen: boolean;
  playbackRate: number;
  positionMs: number;
  seekStepMs: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  setPlaybackRate: Dispatch<SetStateAction<number>>;
  onBack: () => void;
  onCloseContextMenu: () => void;
  onCloseDrawer: () => void;
  onSeek: (positionMs: number) => void;
  onToggleFullscreen: () => Promise<void>;
  onToggleMuted: () => void;
  onTogglePlayback: () => Promise<void>;
};

export function usePlaybackShortcuts({
  contextMenuOpen,
  drawerOpen,
  playbackRate,
  positionMs,
  seekStepMs,
  videoRef,
  setPlaybackRate,
  onBack,
  onCloseContextMenu,
  onCloseDrawer,
  onSeek,
  onToggleFullscreen,
  onToggleMuted,
  onTogglePlayback,
}: PlaybackShortcutOptions) {
  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (contextMenuOpen) onCloseContextMenu();
        else if (drawerOpen) onCloseDrawer();
        else if (document.fullscreenElement) void document.exitFullscreen();
        else onBack();
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, select, textarea, button, a, [contenteditable='true']")
      ) {
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        void onTogglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onSeek(positionMs - seekStepMs);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onSeek(positionMs + seekStepMs);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void onToggleFullscreen();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        onToggleMuted();
      } else if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        const delta = event.key === "[" ? -0.25 : 0.25;
        const nextRate = Math.max(0.5, Math.min(2, playbackRate + delta));
        if (videoRef.current) videoRef.current.playbackRate = nextRate;
        setPlaybackRate(nextRate);
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [
    contextMenuOpen,
    drawerOpen,
    onBack,
    onCloseContextMenu,
    onCloseDrawer,
    onSeek,
    onToggleFullscreen,
    onToggleMuted,
    onTogglePlayback,
    playbackRate,
    positionMs,
    seekStepMs,
    setPlaybackRate,
    videoRef,
  ]);
}
