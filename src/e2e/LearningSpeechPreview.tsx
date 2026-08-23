import { useMemo, useState } from "react";

import { LearningSelectionSection } from "../features/learning/LearningSelectionSection";
import { selectionKind, splitForSelection } from "../features/learning/learningSelection";
import type { LocalSpeechController } from "../features/learning/useLocalSpeech";
import type { SubtitleVersion } from "../types";

const sourceVersion = {
  id: "speech-version",
  trackId: "speech-track",
  projectId: "speech-project",
  role: "original",
  versionNumber: 1,
  status: "ready",
  sourceKind: "transcription",
  sourceLabel: "speech preview",
  sourceSha256: "a".repeat(64),
  mediaSha256: "b".repeat(64),
  languageCode: "en-US",
  projectRevision: 1,
  parentVersionId: null,
  sourceTaskId: null,
  preflight: {} as SubtitleVersion["preflight"],
  createdAtMs: 1,
  isCurrent: true,
  segments: [{
    id: "speech-segment",
    lineageId: "speech-segment",
    sourceSegmentId: null,
    issueKind: null,
    ordinal: 0,
    startMs: 12_000,
    endMs: 16_000,
    text: "The scheduler pauses background work.",
    confidence: 0.98,
    words: [],
  }],
} satisfies SubtitleVersion;

const speech: LocalSpeechController = {
  voices: [],
  matchingVoices: [],
  selectedVoiceId: null,
  state: { kind: "idle" },
  loading: false,
  error: null,
  missingVoiceMessage: "未找到英语声音。请在 Windows 设置的「时间和语言 → 语言和区域」中安装对应语音包。",
  setSelectedVoiceId: () => undefined,
  speak: async () => undefined,
  stop: () => undefined,
};

export function LearningSpeechPreview() {
  const segment = sourceVersion.segments[0];
  const parts = useMemo(
    () => splitForSelection(segment.text, sourceVersion.languageCode),
    [segment.text],
  );
  const [selectedText, setSelectedText] = useState(segment.text);
  return (
    <main className="understanding-preview">
      <section className="learning-panel embedded" aria-label="语言学习">
        <div className="learning-scroll">
          <LearningSelectionSection
            playbackPositionMs={14_000}
            sourceVersion={sourceVersion}
            sourceSegment={segment}
            translationSegment={{ ...segment, id: "translated", text: "调度器会暂停后台工作。" }}
            selectableParts={parts}
            selectedText={selectedText}
            selectionValid={segment.text.includes(selectedText)}
            kind={selectionKind(selectedText, segment.text, parts)}
            speech={speech}
            onSelectText={setSelectedText}
          />
        </div>
      </section>
    </main>
  );
}
