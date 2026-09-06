import type { AiExecutionChoiceKind } from "../ai-tasks/useAiExecutionChoice";
import type { LearningContext } from "./learningContext";

export type LearningDraftExecution = { kind: AiExecutionChoiceKind; serviceId: string | null; modelId: string };
export type LearningDraft = {
  schemaVersion: 1; projectId: string; sourceVersionId: string; translationVersionId: string | null;
  sourceSegmentId: string; playbackPositionMs: number; selectedText: string;
  taskId: string | null; execution: LearningDraftExecution;
};
const key = (projectId: string) => `siaovplay:learning-draft:v1:${projectId}`;
const nullableString = (value: unknown) => value === null || typeof value === "string";
export function readLearningDraft(projectId: string): LearningDraft | null {
  const raw = window.sessionStorage.getItem(key(projectId));
  if (!raw) return null;
  const value = JSON.parse(raw) as Partial<LearningDraft> | null;
  if (!value || value.schemaVersion !== 1 || value.projectId !== projectId ||
      typeof value.sourceVersionId !== "string" || !value.sourceVersionId ||
      typeof value.sourceSegmentId !== "string" || !value.sourceSegmentId ||
      !nullableString(value.translationVersionId) || !nullableString(value.taskId) ||
      typeof value.selectedText !== "string" || typeof value.playbackPositionMs !== "number" ||
      !Number.isFinite(value.playbackPositionMs) || value.playbackPositionMs < 0 ||
      !value.execution || !["api", "codex", "manual"].includes(value.execution.kind) ||
      !nullableString(value.execution.serviceId) || typeof value.execution.modelId !== "string") {
    throw new Error("当前窗口的学习草稿格式无法识别，原记录尚未修改。");
  }
  return value as LearningDraft;
}
export function writeLearningDraft(context: LearningContext, selectedText: string, taskId: string | null, execution: LearningDraftExecution): void {
  if (!context.sourceVersion || !context.sourceSegment) return;
  const draft: LearningDraft = { schemaVersion: 1, projectId: context.projectId,
    sourceVersionId: context.sourceVersion.id, translationVersionId: context.translationVersion?.id ?? null,
    sourceSegmentId: context.sourceSegment.id, playbackPositionMs: context.playbackPositionMs,
    selectedText, taskId, execution: { kind: execution.kind, serviceId: execution.serviceId, modelId: execution.modelId } };
  window.sessionStorage.setItem(key(context.projectId), JSON.stringify(draft));
}
export function discardLearningDraft(projectId: string): void { window.sessionStorage.removeItem(key(projectId)); }

export function loadLearningDraft(projectId: string): { draft: LearningDraft | null; error: string | null } {
  try { return { draft: readLearningDraft(projectId), error: null }; }
  catch (cause) { return { draft: null, error: cause instanceof Error ? cause.message : "无法读取学习草稿。" }; }
}
