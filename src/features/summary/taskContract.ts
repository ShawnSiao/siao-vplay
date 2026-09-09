import validate from "../../generated/summary-task.validator.mjs";
import type { SummaryTask } from "./types";
export function parseSummaryTask(value: unknown, expected: { taskId?: string; projectId?: string } = {}): SummaryTask {
  if (!validate(value) || !value.id.trim() || !value.projectId.trim() || !value.subtitleVersionId.trim() ||
    (expected.taskId !== undefined && value.id !== expected.taskId) ||
    (expected.projectId !== undefined && value.projectId !== expected.projectId) ||
    new Set(value.chunks.map(chunk => chunk.id)).size !== value.chunks.length ||
    new Set(value.chunks.map(chunk => chunk.ordinal)).size !== value.chunks.length ||
    value.chunks.some(chunk => !chunk.id.trim() || chunk.endMs < chunk.startMs) ||
    (value.outputSummaryId !== null && !value.outputSummaryId.trim())) {
    throw new Error("总结任务格式无效或与当前请求不匹配。");
  }
  return value;
}
export function parseSummaryTasks(value: unknown, projectId: string): SummaryTask[] {
  if (!Array.isArray(value)) throw new Error("总结任务列表格式无效。");
  const tasks = value.map(task => parseSummaryTask(task, { projectId }));
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error("总结任务列表包含重复任务。");
  return tasks;
}
