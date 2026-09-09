import type { LearningTask } from "../types";
export function createLearningTaskFixture(): LearningTask {
  return { id: "learning-task", projectId: "project", handoffKind: "codex",
    execution: { kind: "codex", serviceConfigId: null, serviceRevision: null, providerId: null, modelId: null, providerRequestId: null, usage: null },
    protocolVersion: "siaovplay-learning-v1", status: "running", stage: "running", progress: 0,
    receiverLabel: "Codex", materialScope: ["所选原文"], sourceVersionId: "source", translationVersionId: null,
    sourceSegmentId: "segment", selectedText: "hello", selectionKind: "word", playbackPositionMs: 100,
    expectedProjectRevision: 1, outputDictionaryEntryId: null, errorCode: null, errorMessage: null,
    createdAtMs: 1, updatedAtMs: 1, startedAtMs: 1, completedAtMs: null };
}
