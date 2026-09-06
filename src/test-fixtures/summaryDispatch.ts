import type { SummaryDispatchPreview } from "../features/summary/dispatchGateway";

export function summaryDispatchFixture(): SummaryDispatchPreview {
  return {
    taskId: "summary-task-1", confirmationSha256: "a".repeat(64), executionKind: "codex",
    receiver: "OpenAI（经本机 Codex）", endpoint: null, model: "Codex 默认模型",
    scope: "current_progress", playbackCutoffMs: 15_000, subtitleVersionId: "subtitle-1",
    subtitleVersionNumber: 3, subtitleRole: "original", subtitleLanguage: "en", segmentCount: 12,
    firstStartMs: 0, lastEndMs: 16_000, promptTemplate: "自动判断", oneTimeRequirements: "",
    frames: [],
  };
}
