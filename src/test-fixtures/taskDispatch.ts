import type { TaskDispatchPreview } from "../features/ai-tasks/taskDispatch";
import type { ExplanationTask, LearningTask } from "../types";

export function taskDispatchFixture(task: ExplanationTask | LearningTask): TaskDispatchPreview {
  const explanation = "frames" in task;
  const frames = explanation ? task.frames.map(({ id, timestampMs, sha256 }) => ({ id, timestampMs, sha256 })) : [];
  return {
    taskId: task.id, taskKind: explanation ? "explanation" : "learning", confirmationSha256: "b".repeat(64),
    execution: { kind: task.handoffKind === "manual" ? "manual" : "codex" },
    authorization: { subtitles: true, currentQuestion: true, frames: frames.length > 0, serviceRevision: null },
    receiver: task.handoffKind === "manual" ? "自行选择的工具" : "OpenAI（经本机 Codex）", endpoint: null, model: "Codex 默认模型",
    subtitles: [{ versionId: task.sourceVersionId, versionNumber: 1, role: "original", language: "ja" }],
    subtitleCount: explanation ? task.authorizedSegmentIds.length : 1,
    playbackCutoffMs: explanation ? task.playbackCutoffMs : task.playbackPositionMs,
    selectedText: explanation ? null : task.selectedText, frames, prompt: null,
  };
}
