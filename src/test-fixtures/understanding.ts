import type { Explanation, ExplanationTask } from "../types";

type UnderstandingFixtureInput = {
  projectId: string;
  sourceVersionId: string;
  translationVersionId: string;
  sourceSegmentId: string;
};

export function createUnderstandingFixtures(input: UnderstandingFixtureInput): {
  explanationTask: ExplanationTask;
  explanation: Explanation;
} {
  const explanationTask: ExplanationTask = {
    id: "3f4ed2ea-f522-4914-a846-c4187e39caa9",
    projectId: input.projectId,
    handoffKind: "codex",
    execution: { kind: "codex", serviceConfigId: null, serviceRevision: null, providerId: null, modelId: null, providerRequestId: null, usage: null },
    protocolVersion: "siaovplay-understanding-v2",
    status: "queued",
    stage: "queued",
    progress: 0,
    receiverLabel: "本机 Codex",
    materialScope: [
      "播放点前最多三分钟、四十条原文字幕",
      "对应的简体中文字幕（如有）",
      "不晚于播放位置的最多六张关键帧",
    ],
    sourceVersionId: input.sourceVersionId,
    translationVersionId: input.translationVersionId,
    authorizedSegmentIds: [input.sourceSegmentId],
    playbackCutoffMs: 42_000,
    sceneStartMs: 0,
    expectedProjectRevision: 3,
    outputExplanationId: null,
    errorCode: null,
    errorMessage: null,
    createdAtMs: 1_785_354_320_000,
    updatedAtMs: 1_785_354_320_000,
    startedAtMs: null,
    completedAtMs: null,
    frames: [{
      id: "16e2210a-62e4-4df8-a0cc-25a9c218f998",
      ordinal: 0,
      timestampMs: 41_750,
      path: "W:\\SiaoVPlay\\agent-tasks\\task\\input\\frames\\frame-0001.jpg",
      sha256: "d".repeat(64),
    }],
    materialSummary: { subtitleCount: 1, frameCount: 1, startMs: 0, endMs: 42_000 },
  };
  const explanation: Explanation = {
    id: "194b4275-8790-426a-91bb-ee31c01dc902",
    projectId: input.projectId,
    taskId: explanationTask.id,
    sourceVersionId: input.sourceVersionId,
    translationVersionId: input.translationVersionId,
    playbackCutoffMs: 42_000,
    sceneStartMs: 0,
    protocolVersion: explanationTask.protocolVersion,
    materialSummary: explanationTask.materialSummary,
    confirmedFacts: [{
      text: "人物明确提到会在车站前见面。",
      subtitleSegmentIds: explanationTask.authorizedSegmentIds,
      frameIds: [],
    }],
    possibleInterpretations: [{
      text: "结合当前语气，这个约定对人物可能很重要。",
      subtitleSegmentIds: explanationTask.authorizedSegmentIds,
      frameIds: [explanationTask.frames[0].id],
    }],
    withheldReason: "后续发展未展开，以避免剧透。",
    createdAtMs: 1_785_354_330_000,
  };
  return { explanationTask, explanation };
}
