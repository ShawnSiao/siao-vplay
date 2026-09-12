import { expect, it } from "vitest";
import { createPlaybackCompletion } from "./playbackCompletion";

it("requires actual forward playback after the last seek before accepting an ended event", () => {
  const tracker = createPlaybackCompletion();
  tracker.seek(0);
  tracker.observe(500, true);
  expect(tracker.ended()).toBe(true);
  tracker.seek(1000);
  tracker.observe(1000, false);
  expect(tracker.ended()).toBe(false);
  tracker.observe(1000, true);
  expect(tracker.ended()).toBe(false);
  tracker.seek(900);
  tracker.observe(1000, true);
  expect(tracker.ended()).toBe(true);
});
