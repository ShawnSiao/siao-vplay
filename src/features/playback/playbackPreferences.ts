import { useCallback, useState } from "react";

export const seekStepOptions = [5, 10, 15, 30] as const;
export type SeekStepSeconds = (typeof seekStepOptions)[number];

const seekStepStorageKey = "siaovplay-playback-seek-step-seconds";
const defaultSeekStepSeconds: SeekStepSeconds = 10;

function validSeekStep(value: number): value is SeekStepSeconds {
  return seekStepOptions.some((option) => option === value);
}

export function readSeekStepSeconds(): SeekStepSeconds {
  try {
    const value = Number(window.localStorage.getItem(seekStepStorageKey));
    return validSeekStep(value) ? value : defaultSeekStepSeconds;
  } catch {
    return defaultSeekStepSeconds;
  }
}

export function saveSeekStepSeconds(value: SeekStepSeconds) {
  try {
    window.localStorage.setItem(seekStepStorageKey, String(value));
  } catch {
    // Playback remains usable when local preferences cannot be written.
  }
}

export function useSeekStepPreference() {
  const [seekStepSeconds, setSeekStepSeconds] = useState(readSeekStepSeconds);
  const changeSeekStep = useCallback((value: SeekStepSeconds) => {
    saveSeekStepSeconds(value);
    setSeekStepSeconds(value);
  }, []);
  return { seekStepSeconds, changeSeekStep };
}
