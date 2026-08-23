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
      baseTextColor: "#FEF3C7",
      highlightColor: "#67E8F9",
      position: { x: 0.25, y: 0.74 },
    });
    expect(readSubtitleFollowPreferences()).toEqual({
      enabled: false,
      baseTextColor: "#fef3c7",
      highlightColor: "#67e8f9",
      position: { x: 0.25, y: 0.74 },
    });
  });

  it("migrates a valid legacy preference without resetting saved values", () => {
    window.localStorage.setItem(
      "siaovplay-subtitle-follow-preferences-v1",
      JSON.stringify({
        enabled: false,
        highlightColor: "#FB923C",
        position: { x: 0.31, y: 0.82 },
      }),
    );
    expect(readSubtitleFollowPreferences()).toEqual({
      enabled: false,
      baseTextColor: "#ffffff",
      highlightColor: "#fb923c",
      position: { x: 0.31, y: 0.82 },
    });
  });

  it("falls back only the new color when an otherwise valid preference contains an invalid base color", () => {
    window.localStorage.setItem(
      "siaovplay-subtitle-follow-preferences-v1",
      JSON.stringify({
        enabled: true,
        baseTextColor: "white",
        highlightColor: "#49d6e9",
        position: { x: 0.42, y: 0.88 },
      }),
    );
    expect(readSubtitleFollowPreferences()).toEqual({
      enabled: true,
      baseTextColor: "#ffffff",
      highlightColor: "#49d6e9",
      position: { x: 0.42, y: 0.88 },
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
