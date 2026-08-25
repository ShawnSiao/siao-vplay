import type { SubtitleSegment, SubtitleVersion } from "../../types";

export type TranscriptCue = {
  key: string;
  startMs: number;
  endMs: number;
  originalText: string;
  translatedText?: string;
  originalSegmentId?: string;
  translatedSegmentId?: string;
};

export const transcriptNearbyRadius = 12;
export const transcriptStartMatchThresholdMs = 800;

function orderedSegments(version: SubtitleVersion | null): SubtitleSegment[] {
  return [...(version?.segments ?? [])].sort(
    (first, second) =>
      first.startMs - second.startMs || first.endMs - second.endMs,
  );
}

function rangesOverlap(first: SubtitleSegment, second: SubtitleSegment) {
  return first.startMs < second.endMs && second.startMs < first.endMs;
}

function createCue(
  original: SubtitleSegment | undefined,
  translation: SubtitleSegment | undefined,
): TranscriptCue {
  return {
    key: `original:${original?.id ?? "none"}|translation:${translation?.id ?? "none"}`,
    startMs: Math.min(
      original?.startMs ?? Number.POSITIVE_INFINITY,
      translation?.startMs ?? Number.POSITIVE_INFINITY,
    ),
    endMs: Math.max(original?.endMs ?? 0, translation?.endMs ?? 0),
    originalText: original?.text.trim() ?? "",
    translatedText: translation?.text.trim() || undefined,
    originalSegmentId: original?.id,
    translatedSegmentId: translation?.id,
  };
}

export function buildTranscriptCues(
  originalVersion: SubtitleVersion | null,
  translatedVersion: SubtitleVersion | null,
  startMatchThresholdMs = transcriptStartMatchThresholdMs,
): TranscriptCue[] {
  const originals = orderedSegments(originalVersion);
  const translations = orderedSegments(translatedVersion);
  const cues: TranscriptCue[] = [];
  let originalIndex = 0;
  let translationIndex = 0;

  while (
    originalIndex < originals.length ||
    translationIndex < translations.length
  ) {
    const original = originals[originalIndex];
    const translation = translations[translationIndex];
    if (!original) {
      cues.push(createCue(undefined, translation));
      translationIndex += 1;
      continue;
    }
    if (!translation) {
      cues.push(createCue(original, undefined));
      originalIndex += 1;
      continue;
    }

    if (
      rangesOverlap(original, translation) ||
      Math.abs(original.startMs - translation.startMs) <= startMatchThresholdMs
    ) {
      cues.push(createCue(original, translation));
      originalIndex += 1;
      translationIndex += 1;
      continue;
    }

    if (original.startMs < translation.startMs) {
      cues.push(createCue(original, undefined));
      originalIndex += 1;
    } else {
      cues.push(createCue(undefined, translation));
      translationIndex += 1;
    }
  }

  return cues.sort(
    (first, second) =>
      first.startMs - second.startMs || first.endMs - second.endMs,
  );
}

export function findCurrentTranscriptCueIndex(
  cues: readonly TranscriptCue[],
  positionMs: number,
) {
  let low = 0;
  let high = cues.length - 1;
  let currentIndex = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (cues[middle].startMs <= positionMs) {
      currentIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return currentIndex;
}

export function formatTranscriptTime(positionMs: number) {
  const totalSeconds = Math.max(0, Math.floor(positionMs / 1_000));
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${minutes}:${seconds}`
    : `${String(totalMinutes).padStart(2, "0")}:${seconds}`;
}

export function searchTranscriptCues(
  cues: readonly TranscriptCue[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...cues];
  return cues.filter((cue) =>
    [
      formatTranscriptTime(cue.startMs),
      cue.originalText,
      cue.translatedText ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function transcriptCuesNearCurrent(
  cues: readonly TranscriptCue[],
  currentIndex: number,
  radius = transcriptNearbyRadius,
) {
  if (cues.length === 0) return [];
  const center = currentIndex >= 0 ? currentIndex : 0;
  return cues.slice(
    Math.max(0, center - radius),
    Math.min(cues.length, center + radius + 1),
  );
}
