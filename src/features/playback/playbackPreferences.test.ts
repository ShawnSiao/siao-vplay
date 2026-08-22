import { beforeEach, describe, expect, it } from "vitest";

import {
  readSeekStepSeconds,
  saveSeekStepSeconds,
} from "./playbackPreferences";

describe("playback seek preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults invalid or missing values to ten seconds", () => {
    expect(readSeekStepSeconds()).toBe(10);
    window.localStorage.setItem("siaovplay-playback-seek-step-seconds", "20");
    expect(readSeekStepSeconds()).toBe(10);
  });

  it("restores an allowed seek step", () => {
    saveSeekStepSeconds(30);
    expect(readSeekStepSeconds()).toBe(30);
  });
});
