import { useCallback, useState } from "react";

export const seekStepOptions = [5, 10, 15, 30] as const;
export type SeekStepSeconds = (typeof seekStepOptions)[number];

export type SubtitlePosition = { x: number; y: number };
export type SubtitleFollowPreferences = {
  enabled: boolean;
  highlightColor: string;
  position: SubtitlePosition;
};

export const subtitleHighlightPresets = [
  "#b8f36a",
  "#67e8f9",
  "#fbbf24",
  "#fb923c",
  "#f472b6",
  "#c4b5fd",
] as const;

export const defaultSubtitleFollowPreferences: SubtitleFollowPreferences = {
  enabled: true,
  highlightColor: subtitleHighlightPresets[0],
  position: { x: 0.5, y: 0.9 },
};

const seekStepStorageKey = "siaovplay-playback-seek-step-seconds";
const defaultSeekStepSeconds: SeekStepSeconds = 10;
const subtitleFollowStorageKey = "siaovplay-subtitle-follow-preferences-v1";
const hexColorPattern = /^#[0-9a-f]{6}$/i;

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

export function isValidSubtitleHighlightColor(value: string) {
  return hexColorPattern.test(value);
}

function isNormalizedPosition(value: unknown): value is SubtitlePosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<SubtitlePosition>;
  return (
    typeof position.x === "number" &&
    Number.isFinite(position.x) &&
    position.x >= 0 &&
    position.x <= 1 &&
    typeof position.y === "number" &&
    Number.isFinite(position.y) &&
    position.y >= 0 &&
    position.y <= 1
  );
}

export function readSubtitleFollowPreferences(): SubtitleFollowPreferences {
  try {
    const raw = window.localStorage.getItem(subtitleFollowStorageKey);
    if (!raw) return defaultSubtitleFollowPreferences;
    const value = JSON.parse(raw) as Partial<SubtitleFollowPreferences>;
    if (
      typeof value.enabled !== "boolean" ||
      typeof value.highlightColor !== "string" ||
      !isValidSubtitleHighlightColor(value.highlightColor) ||
      !isNormalizedPosition(value.position)
    ) {
      return defaultSubtitleFollowPreferences;
    }
    return {
      enabled: value.enabled,
      highlightColor: value.highlightColor.toLowerCase(),
      position: { ...value.position },
    };
  } catch {
    return defaultSubtitleFollowPreferences;
  }
}

export function saveSubtitleFollowPreferences(
  value: SubtitleFollowPreferences,
) {
  try {
    window.localStorage.setItem(subtitleFollowStorageKey, JSON.stringify(value));
  } catch {
    // Playback remains usable when local preferences cannot be written.
  }
}

export function useSubtitleFollowPreferences() {
  const [subtitleFollowPreferences, setPreferences] = useState(
    readSubtitleFollowPreferences,
  );
  const changeSubtitleFollowPreferences = useCallback(
    (next: SubtitleFollowPreferences) => {
      saveSubtitleFollowPreferences(next);
      setPreferences(next);
    },
    [],
  );
  return {
    subtitleFollowPreferences,
    changeSubtitleFollowPreferences,
  };
}
