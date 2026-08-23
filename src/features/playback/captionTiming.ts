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

type TimedUnit = { word: SubtitleWord; start: number; end: number };

const lexicalTokenPattern = /[\p{L}\p{N}\p{M}]/u;
const latinTokenPattern = /[\p{Script=Latin}\p{N}]/u;
const latinWordCharacterPattern = /[\p{Script=Latin}\p{N}\p{M}'’]/u;

function expandLatinWord(text: string, start: number, end: number) {
  if (!latinTokenPattern.test(text.slice(start, end))) return { start, end };
  let expandedStart = start;
  let expandedEnd = end;
  while (expandedStart > 0 && latinWordCharacterPattern.test(text[expandedStart - 1])) {
    expandedStart -= 1;
  }
  while (expandedEnd < text.length && latinWordCharacterPattern.test(text[expandedEnd])) {
    expandedEnd += 1;
  }
  return { start: expandedStart, end: expandedEnd };
}

function getTimedUnits(segment: SubtitleSegment): TimedUnit[] {
  const units: TimedUnit[] = [];
  for (const aligned of alignTimedWords(segment)) {
    const tokenText = segment.text.slice(aligned.start, aligned.end);
    const previous = units.at(-1);
    if (!lexicalTokenPattern.test(tokenText)) {
      if (previous && aligned.start >= previous.end) {
        previous.end = aligned.end;
        previous.word = {
          ...previous.word,
          endMs: Math.max(previous.word.endMs, aligned.word.endMs),
          text: segment.text.slice(previous.start, aligned.end),
        };
      }
      continue;
    }
    const bounds = expandLatinWord(segment.text, aligned.start, aligned.end);
    if (previous && bounds.start < previous.end) {
      previous.start = Math.min(previous.start, bounds.start);
      previous.end = Math.max(previous.end, bounds.end);
      previous.word = {
        ...previous.word,
        startMs: Math.min(previous.word.startMs, aligned.word.startMs),
        endMs: Math.max(previous.word.endMs, aligned.word.endMs),
        text: segment.text.slice(previous.start, previous.end),
      };
      continue;
    }
    units.push({
      word: { ...aligned.word, text: segment.text.slice(bounds.start, bounds.end) },
      start: bounds.start,
      end: bounds.end,
    });
  }
  return units;
}

export function hasUsableWordTiming(segment: SubtitleSegment) {
  return getTimedUnits(segment).length > 0;
}

export function getTimedCaptionWords(
  segment: SubtitleSegment,
  positionMs: number,
): TimedCaptionWord[] | null {
  const units = getTimedUnits(segment);
  if (!units.length) return null;
  return units.map(({ word }) => {
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
  const units = getTimedUnits(segment);
  if (!units.length) return null;
  const timedWords = getTimedCaptionWords(segment, positionMs)!;
  const fragments: TimedCaptionFragment[] = [];
  let cursor = 0;
  units.forEach(({ start, end }, index) => {
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
