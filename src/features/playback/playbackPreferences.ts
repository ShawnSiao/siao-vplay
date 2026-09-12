import { readPreference, type PreferenceRecord } from "../../lib/preferenceRecord";
import { savePreference } from "../../lib/preferenceNotice";
import { useCallback, useState } from "react";

export const seekStepOptions = [5, 10, 15, 30] as const;
export type SeekStepSeconds = (typeof seekStepOptions)[number];

export type SubtitlePosition = { x: number; y: number };
export type SubtitleFrameSize = {
  widthRatio: number | null;
  minHeightRatio: number | null;
};
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
  frameSize: SubtitleFrameSize;
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
export const defaultSubtitleFrameSize: SubtitleFrameSize = {
  widthRatio: null,
  minHeightRatio: null,
};
export const defaultSubtitleDisplayPreferences: SubtitleDisplayPreferences = {
  ...defaultSubtitleFollowPreferences,
  textSize: "medium",
  quickToolbar: "auto",
  frameSize: defaultSubtitleFrameSize,
};

const seekStepStorageKey = "siaovplay-playback-seek-step-seconds";
const defaultSeekStepSeconds: SeekStepSeconds = 10;
const subtitleFollowStorageKey = "siaovplay-subtitle-follow-preferences-v1";
const subtitleDisplayStorageKey = "siaovplay-subtitle-display-preferences-v3";
const legacySubtitleDisplayStorageKey = "siaovplay-subtitle-display-preferences-v2";
const hexColorPattern = /^#[0-9a-f]{6}$/i;

function validSeekStep(value: number): value is SeekStepSeconds {
  return seekStepOptions.some((option) => option === value);
}

const seekPreference: PreferenceRecord<SeekStepSeconds> = {
  key: "siaovplay-preferences.seek-step",
  fallback: defaultSeekStepSeconds,
  decode: (value) => typeof value === "number" && validSeekStep(value) ? value : undefined,
  legacy: (storage) => Number(storage.getItem(seekStepStorageKey)),
};

export function readSeekStepSeconds(): SeekStepSeconds { return readPreference(seekPreference); }
export function saveSeekStepSeconds(value: SeekStepSeconds) { return savePreference(seekPreference, value); }

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

function isValidFrameSize(value: unknown): value is SubtitleFrameSize {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SubtitleFrameSize>;
  return (
    (candidate.widthRatio === null ||
      (typeof candidate.widthRatio === "number" &&
        Number.isFinite(candidate.widthRatio) &&
        candidate.widthRatio >= 0.3 &&
        candidate.widthRatio <= 0.94)) &&
    (candidate.minHeightRatio === null ||
      (typeof candidate.minHeightRatio === "number" &&
        Number.isFinite(candidate.minHeightRatio) &&
        candidate.minHeightRatio >= 0.1 &&
        candidate.minHeightRatio <= 0.55))
  );
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
  allowMissingFrameSize = false,
): SubtitleDisplayPreferences | null {
  const follow = parseSubtitleFollowPreferences(value);
  if (!follow || !value || typeof value !== "object") return null;
  const candidate = value as Partial<SubtitleDisplayPreferences>;
  if (
    !validSubtitleTextSize(candidate.textSize) ||
    !validQuickToolbarMode(candidate.quickToolbar) ||
    (!allowMissingFrameSize && !isValidFrameSize(candidate.frameSize))
  ) {
    return null;
  }
  return {
    ...follow,
    textSize: candidate.textSize,
    quickToolbar: candidate.quickToolbar,
    frameSize: isValidFrameSize(candidate.frameSize)
      ? { ...candidate.frameSize }
      : { ...defaultSubtitleFrameSize },
  };
}

function readLegacySubtitleDisplayPreferences(storage: Storage): SubtitleDisplayPreferences {
  try {
    const currentRaw = storage.getItem(subtitleDisplayStorageKey);
    if (currentRaw) {
      const current = parseSubtitleDisplayPreferences(JSON.parse(currentRaw));
      if (current) return current;
    }

    const previousDisplayRaw = storage.getItem(
      legacySubtitleDisplayStorageKey,
    );
    if (previousDisplayRaw) {
      const previousDisplay = parseSubtitleDisplayPreferences(
        JSON.parse(previousDisplayRaw),
        true,
      );
      if (previousDisplay) {
        return previousDisplay;
      }
    }

    const legacyRaw = storage.getItem(subtitleFollowStorageKey);
    if (!legacyRaw) return defaultSubtitleDisplayPreferences;
    const legacy = parseSubtitleFollowPreferences(JSON.parse(legacyRaw));
    if (!legacy) return defaultSubtitleDisplayPreferences;
    const migrated = {
      ...legacy,
      textSize: "medium",
      quickToolbar: "auto",
      frameSize: { ...defaultSubtitleFrameSize },
    } as const;
    return migrated;
  } catch {
    return defaultSubtitleDisplayPreferences;
  }
}

const displayPreference: PreferenceRecord<SubtitleDisplayPreferences> = {
  key: "siaovplay-preferences.subtitle-display",
  fallback: defaultSubtitleDisplayPreferences,
  decode: (value) => parseSubtitleDisplayPreferences(value) ?? undefined,
  legacy: readLegacySubtitleDisplayPreferences,
};

export function readSubtitleDisplayPreferences(): SubtitleDisplayPreferences {
  return readPreference(displayPreference);
}

export function saveSubtitleDisplayPreferences(value: SubtitleDisplayPreferences) {
  return savePreference(displayPreference, value);
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
