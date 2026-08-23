import { describe, expect, it } from "vitest";

import type { SpeechVoice } from "./speechTypes";
import { preferredVoice, voicesForLanguage } from "./voiceMatching";

const voices: SpeechVoice[] = [
  { id: "en-us", displayName: "English US", language: "en-US" },
  { id: "en-gb", displayName: "English UK", language: "en-GB" },
  { id: "ja-jp", displayName: "日本語", language: "ja-JP" },
];

describe("Windows speech voice matching", () => {
  it("uses exact BCP-47 matches before same-base matches", () => {
    expect(voicesForLanguage(voices, "en-US").map((voice) => voice.id)).toEqual(["en-us"]);
    expect(voicesForLanguage(voices, "en").map((voice) => voice.id)).toEqual(["en-us", "en-gb"]);
  });

  it("never substitutes a voice from another language", () => {
    expect(preferredVoice(voices, "th-TH", "en-us")).toBeNull();
    expect(preferredVoice(voices, "ko-KR", null)).toBeNull();
  });
});
