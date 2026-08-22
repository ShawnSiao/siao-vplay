import type { SubtitleSegment, SubtitleWord } from "../../types";

export type TimedCaptionWord = SubtitleWord & {
  state: "spoken" | "current" | "future";
  progress: number;
};

export type TimedCaptionFragment =
  | { kind: "plain"; key: string; text: string }
  | { kind: "timed"; key: string; text: string; word: TimedCaptionWord };

function alignTimedWords(segment: SubtitleSegment) {
  const aligned: Array<{ word: SubtitleWord; start: number; end: number }> = [];
  const searchableText = segment.text.toLocaleLowerCase();
  let cursor = 0;
  let previousEnd = segment.startMs;
  for (const word of segment.words) {
    const token = word.text.trim();
    if (
      !token ||
      !Number.isFinite(word.startMs) ||
      !Number.isFinite(word.endMs) ||
      word.startMs < segment.startMs ||
      word.endMs > segment.endMs ||
      word.endMs <= word.startMs ||
      word.startMs < previousEnd
    ) {
      continue;
    }
    previousEnd = word.endMs;
    const start = searchableText.indexOf(token.toLocaleLowerCase(), cursor);
    if (start < 0) continue;
    const end = start + token.length;
    aligned.push({ word, start, end });
    cursor = end;
  }
  return aligned;
}

export function hasUsableWordTiming(segment: SubtitleSegment) {
  return alignTimedWords(segment).length > 0;
}

export function getTimedCaptionWords(
  segment: SubtitleSegment,
  positionMs: number,
): TimedCaptionWord[] | null {
  const aligned = alignTimedWords(segment);
  if (!aligned.length) return null;
  return aligned.map(({ word }) => {
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

export function getTimedCaptionFragments(
  segment: SubtitleSegment,
  positionMs: number,
): TimedCaptionFragment[] | null {
  const aligned = alignTimedWords(segment);
  if (!aligned.length) return null;
  const timedWords = getTimedCaptionWords(segment, positionMs)!;
  const fragments: TimedCaptionFragment[] = [];
  let cursor = 0;
  aligned.forEach(({ start, end }, index) => {
    if (start > cursor) {
      fragments.push({ kind: "plain", key: `plain:${cursor}`, text: segment.text.slice(cursor, start) });
    }
    const word = timedWords[index];
    fragments.push({ kind: "timed", key: `word:${word.ordinal}:${word.startMs}`, text: segment.text.slice(start, end), word });
    cursor = end;
  });
  if (cursor < segment.text.length) {
    fragments.push({ kind: "plain", key: `plain:${cursor}`, text: segment.text.slice(cursor) });
  }
  return fragments;
}
