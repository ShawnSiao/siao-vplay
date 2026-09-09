import type { SubtitleVersion } from "../types";

export function createPlayerSubtitleFixtures(projectId: string) {
  const originalSubtitle: SubtitleVersion = {
    id: "e2e-original",
    trackId: "e2e-original-track",
    projectId: projectId,
    role: "original",
    versionNumber: 1,
    status: "ready",
    sourceKind: "transcription",
    sourceLabel: "交互测试转写",
    sourceSha256: "b".repeat(64),
    mediaSha256: "a".repeat(64),
    languageCode: "en",
    projectRevision: 1,
    parentVersionId: null,
    sourceTaskId: null,
    preflight: {
      status: "warning", segmentCount: 1, errorCount: 0, warningCount: 1,
      firstStartMs: 14_000, lastEndMs: 18_000, mediaDurationMs: 120_000, coverageRatio: 4_000 / 120_000,
      issues: [{ code: "long_gap", severity: "warning", ordinal: 0, relatedOrdinal: null, message: "最后一条字幕距离媒体结束超过 30 秒" }],
    },
    createdAtMs: 1,
    isCurrent: true,
    segments: [{
      id: "e2e-original-segment",
      lineageId: "e2e-original-segment",
      sourceSegmentId: null,
      issueKind: null,
      ordinal: 0,
      startMs: 14_000,
      endMs: 18_000,
      text: "Okay, and that's essentially how the system stores the new memories.",
      confidence: 0.95,
      words: [
        { ordinal: 0, startMs: 14_000, endMs: 14_300, text: "okay", confidence: 0.95 },
        { ordinal: 1, startMs: 14_300, endMs: 14_500, text: ",", confidence: 0.95 },
        { ordinal: 2, startMs: 14_500, endMs: 14_800, text: "and", confidence: 0.95 },
        { ordinal: 3, startMs: 14_800, endMs: 15_300, text: "essentially", confidence: 0.95 },
        { ordinal: 4, startMs: 15_300, endMs: 15_600, text: "how", confidence: 0.95 },
        { ordinal: 5, startMs: 15_600, endMs: 15_850, text: "the", confidence: 0.95 },
        { ordinal: 6, startMs: 15_850, endMs: 16_250, text: "system", confidence: 0.95 },
        { ordinal: 7, startMs: 16_250, endMs: 16_650, text: "stores", confidence: 0.95 },
        { ordinal: 8, startMs: 16_650, endMs: 16_900, text: "the", confidence: 0.95 },
        { ordinal: 9, startMs: 16_900, endMs: 17_200, text: "new", confidence: 0.95 },
        { ordinal: 10, startMs: 17_200, endMs: 17_800, text: "memories", confidence: 0.95 },
        { ordinal: 11, startMs: 17_800, endMs: 18_000, text: ".", confidence: 0.95 },
      ],
    }],
  };

  const translatedSubtitle: SubtitleVersion = {
    ...originalSubtitle,
    id: "e2e-translation",
    trackId: "e2e-translation-track",
    role: "translation",
    sourceKind: "agent_translation",
    sourceLabel: "交互测试翻译",
    sourceSha256: "c".repeat(64),
    languageCode: "zh-cn",
    segments: [{
      ...originalSubtitle.segments[0],
      id: "e2e-translation-segment",
      lineageId: "e2e-translation-segment",
      sourceSegmentId: originalSubtitle.segments[0].id,
      text: "这句话会跟随每一个单词。",
      words: [],
    }],
  };

  return { originalSubtitle, translatedSubtitle };
}
