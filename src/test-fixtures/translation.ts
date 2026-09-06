import type { TranslationTask } from "../types";
import type { TranslationDispatchPreview } from "../features/ai-tasks/translationDispatch";

export function translationDispatchFixture(task: TranslationTask, version: { versionNumber: number; segments: Array<{ id: string; startMs: number; endMs: number }> }): TranslationDispatchPreview {
  return {
    taskId: task.id, confirmationSha256: "c".repeat(64), handoffKind: task.handoffKind,
    receiver: task.handoffKind === "manual" ? "自行选择的外部工具" : "OpenAI（通过本机 Codex 登录，需要联网）",
    model: "Codex 默认模型", sourceVersionId: task.sourceVersionId, sourceVersionNumber: version.versionNumber,
    sourceLanguageCode: task.sourceLanguageCode, targetLanguageCode: task.targetLanguageCode,
    scope: task.segmentCount === version.segments.length ? "full_subtitles" : "selected_subtitles",
    segments: version.segments.filter((item) => task.authorizedSegmentIds.includes(item.id)).map(({ id, startMs, endMs }) => ({ id, startMs, endMs })),
    context: { characters: [], storyContext: null, consistencyRules: ["Only translate the authorized sequence."] },
    glossary: { people: [], places: [], terms: [] },
  };
}

export function createTranslationTask(projectId: string, subtitleVersion: { id: string; segments: Array<{ id: string }> }): TranslationTask {
return {
  id: "f92041a1-5d07-4db0-b63d-565c12ceab36",
  projectId: projectId,
  taskType: "subtitle_translation",
  handoffKind: "codex",
  protocolVersion: "siaovplay-agent-v1",
  status: "queued",
  stage: "queued",
  progress: 0,
  receiverLabel: "本机 Codex",
  materialScope: [
    "原文字幕文本",
    "字幕时间码",
    "任务与字幕版本标识",
    "人物与术语上下文（当前为空）",
  ],
  sourceVersionId: subtitleVersion.id,
  sourceLanguageCode: "ja",
  targetLanguageCode: "zh-cn",
  authorizedSegmentIds: [subtitleVersion.segments[0].id],
  segmentCount: 1,
  expectedProjectRevision: 2,
  baseTranslationVersionId: null,
  outputVersionId: null,
  validation: null,
  errorCode: null,
  errorMessage: null,
  createdAtMs: 1_785_354_300_000,
  updatedAtMs: 1_785_354_300_000,
  startedAtMs: null,
  completedAtMs: null,
};

}
