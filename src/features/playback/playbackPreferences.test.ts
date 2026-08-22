import { beforeEach, describe, expect, it } from "vitest";

import {
  defaultSubtitleFollowPreferences,
  readSeekStepSeconds,
  readSubtitleFollowPreferences,
  saveSeekStepSeconds,
  saveSubtitleFollowPreferences,
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

describe("subtitle follow preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores a complete valid preference", () => {
    saveSubtitleFollowPreferences({
      enabled: false,
      highlightColor: "#67E8F9",
      position: { x: 0.25, y: 0.74 },
    });
    expect(readSubtitleFollowPreferences()).toEqual({
      enabled: false,
      highlightColor: "#67e8f9",
      position: { x: 0.25, y: 0.74 },
    });
  });

  it.each([
    { enabled: true, highlightColor: "#123", position: { x: 0.5, y: 0.9 } },
    { enabled: true, highlightColor: "#b8f36a", position: { x: -1, y: 0.9 } },
    { enabled: "yes", highlightColor: "#b8f36a", position: { x: 0.5, y: 0.9 } },
  ])("falls back atomically for invalid data", (value) => {
    window.localStorage.setItem(
      "siaovplay-subtitle-follow-preferences-v1",
      JSON.stringify(value),
    );
    expect(readSubtitleFollowPreferences()).toEqual(
      defaultSubtitleFollowPreferences,
    );
  });
});
