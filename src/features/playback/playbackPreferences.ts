import { useCallback, useState } from "react";

export const seekStepOptions = [5, 10, 15, 30] as const;
export type SeekStepSeconds = (typeof seekStepOptions)[number];

export type SubtitlePosition = { x: number; y: number };
export type SubtitleFollowPreferences = {
  enabled: boolean;
  baseTextColor: string;
  highlightColor: string;
  position: SubtitlePosition;
};
export const subtitleTextSizes = ["small", "medium", "large"] as const;
export type SubtitleTextSize = (typeof subtitleTextSizes)[number];
export const subtitleQuickToolbarModes = ["auto", "always", "hidden"] as const;
export type SubtitleQuickToolbarMode = (typeof subtitleQuickToolbarModes)[number];
export type SubtitleDisplayPreferences = SubtitleFollowPreferences & {
  textSize: SubtitleTextSize;
  quickToolbar: SubtitleQuickToolbarMode;
};

export const subtitleBaseColorPresets = [
  "#ffffff",
  "#e5e7eb",
  "#fef3c7",
  "#dbeafe",
  "#dcfce7",
  "#fce7f3",
] as const;

export const subtitleHighlightPresets = [
  "#b8f36a",
  "#49d6e9",
  "#fbbf24",
  "#fb923c",
  "#f472b6",
  "#c4b5fd",
] as const;

export const defaultSubtitleFollowPreferences: SubtitleFollowPreferences = {
  enabled: true,
  baseTextColor: subtitleBaseColorPresets[0],
  highlightColor: subtitleHighlightPresets[0],
  position: { x: 0.5, y: 0.9 },
};
export const defaultSubtitleDisplayPreferences: SubtitleDisplayPreferences = {
  ...defaultSubtitleFollowPreferences,
  textSize: "medium",
  quickToolbar: "auto",
};

const seekStepStorageKey = "siaovplay-playback-seek-step-seconds";
const defaultSeekStepSeconds: SeekStepSeconds = 10;
const subtitleFollowStorageKey = "siaovplay-subtitle-follow-preferences-v1";
const subtitleDisplayStorageKey = "siaovplay-subtitle-display-preferences-v2";
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

export const isValidSubtitleColor = isValidSubtitleHighlightColor;

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

function validSubtitleTextSize(value: unknown): value is SubtitleTextSize {
  return subtitleTextSizes.some((size) => size === value);
}

function validQuickToolbarMode(value: unknown): value is SubtitleQuickToolbarMode {
  return subtitleQuickToolbarModes.some((mode) => mode === value);
}

function parseSubtitleFollowPreferences(
  value: unknown,
): SubtitleFollowPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SubtitleFollowPreferences>;
  if (
    typeof candidate.enabled !== "boolean" ||
    typeof candidate.highlightColor !== "string" ||
    !isValidSubtitleHighlightColor(candidate.highlightColor) ||
    !isNormalizedPosition(candidate.position)
  ) {
    return null;
  }
  return {
    enabled: candidate.enabled,
    baseTextColor:
      typeof candidate.baseTextColor === "string" &&
      isValidSubtitleColor(candidate.baseTextColor)
        ? candidate.baseTextColor.toLowerCase()
        : defaultSubtitleFollowPreferences.baseTextColor,
    highlightColor: candidate.highlightColor.toLowerCase(),
    position: { ...candidate.position },
  };
}

function parseSubtitleDisplayPreferences(
  value: unknown,
): SubtitleDisplayPreferences | null {
  const follow = parseSubtitleFollowPreferences(value);
  if (!follow || !value || typeof value !== "object") return null;
  const candidate = value as Partial<SubtitleDisplayPreferences>;
  if (
    !validSubtitleTextSize(candidate.textSize) ||
    !validQuickToolbarMode(candidate.quickToolbar)
  ) {
    return null;
  }
  return {
    ...follow,
    textSize: candidate.textSize,
    quickToolbar: candidate.quickToolbar,
  };
}

export function readSubtitleDisplayPreferences(): SubtitleDisplayPreferences {
  try {
    const currentRaw = window.localStorage.getItem(subtitleDisplayStorageKey);
    if (currentRaw) {
      const current = parseSubtitleDisplayPreferences(JSON.parse(currentRaw));
      if (current) return current;
    }

    const legacyRaw = window.localStorage.getItem(subtitleFollowStorageKey);
    if (!legacyRaw) return defaultSubtitleDisplayPreferences;
    const legacy = parseSubtitleFollowPreferences(JSON.parse(legacyRaw));
    if (!legacy) return defaultSubtitleDisplayPreferences;
    const migrated = { ...legacy, textSize: "medium", quickToolbar: "auto" } as const;
    saveSubtitleDisplayPreferences(migrated);
    return migrated;
  } catch {
    return defaultSubtitleDisplayPreferences;
  }
}

export function saveSubtitleDisplayPreferences(
  value: SubtitleDisplayPreferences,
) {
  try {
    window.localStorage.setItem(subtitleDisplayStorageKey, JSON.stringify(value));
  } catch {
    // Playback remains usable when local preferences cannot be written.
  }
}

export function useSubtitleDisplayPreferences() {
  const [subtitleDisplayPreferences, setPreferences] = useState(
    readSubtitleDisplayPreferences,
  );
  const changeSubtitleDisplayPreferences = useCallback(
    (next: SubtitleDisplayPreferences) => {
      saveSubtitleDisplayPreferences(next);
      setPreferences(next);
    },
    [],
  );
  return {
    subtitleDisplayPreferences,
    changeSubtitleDisplayPreferences,
  };
}

export function readSubtitleFollowPreferences(): SubtitleFollowPreferences {
  const { enabled, baseTextColor, highlightColor, position } =
    readSubtitleDisplayPreferences();
  return { enabled, baseTextColor, highlightColor, position };
}

export function saveSubtitleFollowPreferences(
  value: SubtitleFollowPreferences,
) {
  saveSubtitleDisplayPreferences({
    ...readSubtitleDisplayPreferences(),
    ...value,
  });
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
