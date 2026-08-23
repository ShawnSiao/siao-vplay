import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { SubtitleSegment, SubtitleVersion } from "../../types";
import { LearningSelectionSection } from "./LearningSelectionSection";
import { splitForSelection } from "./learningSelection";
import type { LocalSpeechController } from "./useLocalSpeech";

const segment: SubtitleSegment = {
  id: "segment-1",
  lineageId: "segment-1",
  sourceSegmentId: null,
  issueKind: null,
  ordinal: 0,
  startMs: 0,
  endMs: 2_000,
  text: "The scheduler pauses.",
  confidence: 1,
  words: [],
};

const version = {
  languageCode: "en-US",
  segments: [segment],
} as SubtitleVersion;

it("selects and reads a word in one click", () => {
  const speak = vi.fn().mockResolvedValue(undefined);
  const onSelectText = vi.fn();
  const speech = {
    voices: [{ id: "voice", displayName: "English", language: "en-US" }],
    matchingVoices: [{ id: "voice", displayName: "English", language: "en-US" }],
    selectedVoiceId: "voice",
    state: { kind: "idle" },
    loading: false,
    error: null,
    missingVoiceMessage: null,
    setSelectedVoiceId: vi.fn(),
    speak,
    stop: vi.fn(),
  } satisfies LocalSpeechController;
  render(
    <LearningSelectionSection
      playbackPositionMs={1_000}
      sourceVersion={version}
      sourceSegment={segment}
      translationSegment={null}
      selectableParts={splitForSelection(segment.text, version.languageCode)}
      selectedText={segment.text}
      selectionValid
      kind="sentence"
      speech={speech}
      onSelectText={onSelectText}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "scheduler" }));
  expect(onSelectText).toHaveBeenCalledWith("scheduler");
  expect(speak).toHaveBeenCalledWith(
    "scheduler",
    "en-US",
    "word:segment-1:scheduler",
  );
});
