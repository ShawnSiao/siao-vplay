import { useCallback, useEffect, useRef, useState } from "react";

export const fullscreenControlsHideDelayMs = 2_200;

export function useFullscreenControlVisibility(fullscreen: boolean) {
  const [visible, setVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);
  const revealControls = useCallback(() => {
    clearHideTimer();
    setVisible(true);
    if (fullscreen) {
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setVisible(false);
      }, fullscreenControlsHideDelayMs);
    }
  }, [clearHideTimer, fullscreen]);

  useEffect(() => {
    clearHideTimer();
    if (!fullscreen) return undefined;
    const revealTimer = window.setTimeout(revealControls, 0);
    return () => {
      window.clearTimeout(revealTimer);
      clearHideTimer();
    };
  }, [clearHideTimer, fullscreen, revealControls]);

  return {
    controlsVisible: !fullscreen || visible,
    revealControls,
  };
}
