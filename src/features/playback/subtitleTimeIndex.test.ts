import { expect, it } from "vitest";
import { createSubtitleTimeIndex } from "./subtitleTimeIndex";

it("preserves first-in-source-order selection for overlaps, gaps and exact boundaries", () => {
  const segments = [{ startMs: 20, endMs: 60 }, { startMs: 0, endMs: 100 },
    { startMs: 5, endMs: 10 }, { startMs: 120, endMs: 130 }, { startMs: 90, endMs: 90 }];
  const lookup = createSubtitleTimeIndex(segments);
  for (let position = -1; position <= 140; position++) {
    expect(lookup(position)).toBe(segments.find(item => position >= item.startMs && position < item.endMs) ?? null);
  }
  expect(lookup(NaN)).toBeNull();
  expect(createSubtitleTimeIndex([])(0)).toBeNull();
});

it("does not rescan 10000 cue timestamps on every playback update", () => {
  let reads = 0;
  const segments = Array.from({ length: 10000 }, (_, index) => ({
    get startMs() { reads++; return index * 1000; },
    get endMs() { reads++; return index * 1000 + 900; },
  }));
  const lookup = createSubtitleTimeIndex(segments);
  reads = 0;
  for (let index = 9990; index < 10000; index++) expect(lookup(index * 1000 + 1)).toBe(segments[index]);
  expect(reads).toBeLessThan(100);
});

it("matches linear selection for deterministically mixed and nested intervals", () => {
  let seed = 42;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const segments = Array.from({ length: 500 }, () => {
    const startMs = next() % 1000;
    return { startMs, endMs: startMs + next() % 120 };
  });
  const lookup = createSubtitleTimeIndex(segments);
  for (let time = 0; time < 1200; time++) {
    expect(lookup(time)).toBe(segments.find(item => time >= item.startMs && time < item.endMs) ?? null);
  }
});
