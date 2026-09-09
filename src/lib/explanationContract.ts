import validateTask from "../generated/explanation-task.validator.mjs";
import validateResult from "../generated/explanation.validator.mjs";
import validateApplication from "../generated/explanation-application.validator.mjs";
import type { Explanation, ExplanationTask, ExplanationApplication } from "../types";
const protocol = (value: string) => ["siaovplay-understanding-v1", "siaovplay-understanding-v2"].includes(value);
type Expected = { taskId?: string; projectId?: string; handoffKind?: ExplanationTask["handoffKind"] };
export function parseExplanationTask(value: unknown, expected: Expected = {}): ExplanationTask {
  if (!validateTask(value) || !value.id.trim() || !value.projectId.trim() || !value.sourceVersionId.trim() || !protocol(value.protocolVersion) ||
    value.handoffKind !== value.execution.kind || (expected.taskId !== undefined && value.id !== expected.taskId) ||
    (expected.projectId !== undefined && value.projectId !== expected.projectId) ||
    (expected.handoffKind !== undefined && value.handoffKind !== expected.handoffKind) ||
    value.sceneStartMs < 0 || value.sceneStartMs > value.playbackCutoffMs ||
    new Set(value.authorizedSegmentIds).size !== value.authorizedSegmentIds.length || value.authorizedSegmentIds.some(id => !id.trim()) ||
    new Set(value.frames.map(frame => frame.id)).size !== value.frames.length ||
    value.frames.some(frame => !frame.id.trim() || frame.timestampMs < 0 || frame.timestampMs > value.playbackCutoffMs)) {
    throw new Error("解释任务格式无效或与当前请求不匹配。");
  }
  return value;
}
export function parseExplanation(value: unknown, expected: { explanationId?: string; projectId?: string } = {}): Explanation {
  if (!validateResult(value) || !value.id.trim() || !value.projectId.trim() || !value.taskId.trim() || !value.sourceVersionId.trim() ||
    !protocol(value.protocolVersion) || (expected.explanationId !== undefined && value.id !== expected.explanationId) ||
    (expected.projectId !== undefined && value.projectId !== expected.projectId) ||
    value.sceneStartMs < 0 || value.sceneStartMs > value.playbackCutoffMs || value.materialSummary.startMs > value.materialSummary.endMs) {
    throw new Error("解释结果格式无效或与当前请求不匹配。");
  }
  return value;
}
export function parseExplanationTasks(value: unknown, projectId: string): ExplanationTask[] {
  if (!Array.isArray(value)) throw new Error("解释任务列表格式无效。");
  const tasks = value.map(task => parseExplanationTask(task, { projectId }));
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error("解释任务列表包含重复任务。");
  return tasks;
}
export function parseExplanations(value: unknown, projectId: string): Explanation[] {
  if (!Array.isArray(value)) throw new Error("解释历史列表格式无效。");
  const entries = value.map(entry => parseExplanation(entry, { projectId }));
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error("解释历史列表包含重复结果。");
  return entries;
}
export function requireExplanationResult(value: unknown, task: ExplanationTask): Explanation {
  const result = parseExplanation(value, { projectId: task.projectId });
  if (result.taskId !== task.id || (task.outputExplanationId !== null && result.id !== task.outputExplanationId) ||
    result.sourceVersionId !== task.sourceVersionId || result.translationVersionId !== task.translationVersionId ||
    result.protocolVersion !== task.protocolVersion || result.playbackCutoffMs !== task.playbackCutoffMs || result.sceneStartMs !== task.sceneStartMs ||
    result.materialSummary.subtitleCount !== task.materialSummary.subtitleCount || result.materialSummary.frameCount !== task.materialSummary.frameCount ||
    result.materialSummary.startMs !== task.materialSummary.startMs || result.materialSummary.endMs !== task.materialSummary.endMs) throw new Error("解释结果与任务上下文不匹配。");
  const segments = new Set(task.authorizedSegmentIds); const frames = new Set(task.frames.map(frame => frame.id));
  if ([...result.confirmedFacts, ...result.possibleInterpretations].some(entry =>
    entry.subtitleSegmentIds.some(id => !segments.has(id)) || entry.frameIds.some(id => !frames.has(id)))) throw new Error("解释结果包含未授权的证据引用。");
  return result;
}
export function parseExplanationApplication(value: unknown, taskId: string): ExplanationApplication {
  if (!validateApplication(value)) throw new Error("解释结果封装格式无效。");
  const task = parseExplanationTask(value.task, { taskId });
  if (task.status !== "completed" || !task.outputExplanationId) throw new Error("解释任务尚未完成或缺少结果标识。");
  requireExplanationResult(value.explanation, task);
  return value;
}
