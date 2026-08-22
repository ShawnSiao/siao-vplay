import type { SubtitleSegment, SubtitleWord } from "../../types";

export type TimedCaptionWord = SubtitleWord & {
  state: "spoken" | "current" | "future";
  progress: number;
};

function comparableText(value: string) {
  return value.replace(/\s+/gu, "").trim();
}

export function hasUsableWordTiming(segment: SubtitleSegment) {
  if (!segment.words.length) return false;
  let previousEnd = segment.startMs;
  for (const word of segment.words) {
    if (
      !word.text ||
      !Number.isFinite(word.startMs) ||
      !Number.isFinite(word.endMs) ||
      word.startMs < segment.startMs ||
      word.endMs > segment.endMs ||
      word.endMs <= word.startMs ||
      word.startMs < previousEnd
    ) {
      return false;
    }
    previousEnd = word.endMs;
  }
  return (
    comparableText(segment.words.map((word) => word.text).join("")) ===
    comparableText(segment.text)
  );
}

export function getTimedCaptionWords(
  segment: SubtitleSegment,
  positionMs: number,
): TimedCaptionWord[] | null {
  if (!hasUsableWordTiming(segment)) return null;
  return segment.words.map((word) => {
    if (positionMs >= word.endMs) {
      return { ...word, state: "spoken" as const, progress: 1 };
    }
    if (positionMs >= word.startMs) {
      return {
        ...word,
        state: "current" as const,
        progress: Math.max(
          0,
          Math.min(1, (positionMs - word.startMs) / (word.endMs - word.startMs)),
        ),
      };
    }
    return { ...word, state: "future" as const, progress: 0 };
  });
}
