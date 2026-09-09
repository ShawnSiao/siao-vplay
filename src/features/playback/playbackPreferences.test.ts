import { beforeEach, describe, expect, it } from "vitest";

import {
  defaultSubtitleDisplayPreferences,
  defaultSubtitleFollowPreferences,
  readSeekStepSeconds,
  readSubtitleDisplayPreferences,
  readSubtitleFollowPreferences,
  saveSeekStepSeconds,
  saveSubtitleDisplayPreferences,
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

describe("subtitle display preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores a complete v3 display preference", () => {
    saveSubtitleDisplayPreferences({
      ...defaultSubtitleDisplayPreferences,
      enabled: false,
      textSize: "large",
      quickToolbar: "always",
      position: { x: 0.34, y: 0.78 },
      frameSize: { widthRatio: 0.72, minHeightRatio: 0.24 },
    });

    expect(readSubtitleDisplayPreferences()).toEqual({
      ...defaultSubtitleDisplayPreferences,
      enabled: false,
      textSize: "large",
      quickToolbar: "always",
      position: { x: 0.34, y: 0.78 },
      frameSize: { widthRatio: 0.72, minHeightRatio: 0.24 },
    });
  });

  it("migrates a valid v2 display preference into the v3 key", () => {
    window.localStorage.setItem(
      "siaovplay-subtitle-display-preferences-v2",
      JSON.stringify({
        ...defaultSubtitleFollowPreferences,
        textSize: "large",
        quickToolbar: "always",
      }),
    );

    expect(readSubtitleDisplayPreferences()).toEqual({
      ...defaultSubtitleFollowPreferences,
      textSize: "large",
      quickToolbar: "always",
      frameSize: { widthRatio: null, minHeightRatio: null },
    });
    expect(window.localStorage.getItem("siaovplay-subtitle-display-preferences-v3")).toBeNull();
    expect(window.localStorage.getItem("siaovplay-preferences.subtitle-display")).toBeNull();
    saveSubtitleDisplayPreferences(readSubtitleDisplayPreferences());
    expect(JSON.parse(window.localStorage.getItem("siaovplay-preferences.subtitle-display")!)).toMatchObject({version: 1, value: {textSize: "large"}});
  });

  it("reads valid v1 preferences without writing on mount", () => {
    window.localStorage.setItem(
      "siaovplay-subtitle-follow-preferences-v1",
      JSON.stringify({
        enabled: false,
        baseTextColor: "#DBEAFE",
        highlightColor: "#FB923C",
        position: { x: 0.41, y: 0.83 },
      }),
    );

    expect(readSubtitleDisplayPreferences()).toEqual({
      enabled: false,
      baseTextColor: "#dbeafe",
      highlightColor: "#fb923c",
      position: { x: 0.41, y: 0.83 },
      textSize: "medium",
      quickToolbar: "auto",
      frameSize: { widthRatio: null, minHeightRatio: null },
    });
    expect(window.localStorage.getItem("siaovplay-subtitle-display-preferences-v3")).toBeNull();
    expect(window.localStorage.getItem("siaovplay-preferences.subtitle-display")).toBeNull();
  });

  it.each([
    { textSize: "huge", quickToolbar: "auto" },
    { textSize: "medium", quickToolbar: "sometimes" },
    { textSize: "medium", quickToolbar: "auto", frameSize: { widthRatio: 0.1, minHeightRatio: null } },
    { textSize: "medium", quickToolbar: "auto", frameSize: { widthRatio: null, minHeightRatio: 0.9 } },
  ])("rejects unknown display values", (invalid) => {
    window.localStorage.setItem(
      "siaovplay-subtitle-display-preferences-v3",
      JSON.stringify({ ...defaultSubtitleDisplayPreferences, ...invalid }),
    );
    expect(readSubtitleDisplayPreferences()).toEqual(
      defaultSubtitleDisplayPreferences,
    );
  });
});
