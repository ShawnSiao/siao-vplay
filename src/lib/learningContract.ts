import validateTask from "../generated/learning-task.validator.mjs";
import validateApplication from "../generated/learning-application.validator.mjs";
import { requireLearningResult } from "../features/learning/learningResult";
import type { LearningTask, LearningApplication } from "../types";
export function parseLearningTask(value: unknown, expected: { taskId?: string; projectId?: string; handoffKind?: LearningTask["handoffKind"] } = {}): LearningTask {
  if (!validateTask(value) || !value.id.trim() || !value.projectId.trim() || !value.sourceVersionId.trim() ||
    value.protocolVersion !== "siaovplay-learning-v1" || !value.sourceSegmentId.trim() || !value.selectedText.trim() || value.handoffKind !== value.execution.kind ||
    (expected.handoffKind !== undefined && value.handoffKind !== expected.handoffKind) ||
    (expected.taskId !== undefined && value.id !== expected.taskId) ||
    (expected.projectId !== undefined && value.projectId !== expected.projectId) ||
    (value.translationVersionId !== null && !value.translationVersionId.trim()) ||
    (value.outputDictionaryEntryId !== null && !value.outputDictionaryEntryId.trim())) throw new Error("学习任务格式无效或与当前请求不匹配。");
  return value;
}
export function parseLearningTasks(value: unknown, projectId: string): LearningTask[] {
  if (!Array.isArray(value)) throw new Error("学习任务列表格式无效。");
  const tasks = value.map(task => parseLearningTask(task, { projectId }));
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error("学习任务列表包含重复任务。");
  return tasks;
}
export function parseLearningApplication(value: unknown, taskId: string): LearningApplication {
  if (!validateApplication(value)) throw new Error("学习结果封装格式无效。");
  const task = parseLearningTask(value.task, { taskId });
  if (task.status !== "completed" || !task.outputDictionaryEntryId) throw new Error("学习任务尚未完成或缺少结果标识。");
  requireLearningResult(value.dictionaryEntry, task);
  return value;
}
