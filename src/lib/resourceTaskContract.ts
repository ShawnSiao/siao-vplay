import validateTask from "../generated/resource-download-task.validator.mjs";
import validatePreparation from "../generated/capability-preparation.validator.mjs";
import type { ResourceDownloadTask, CapabilityPreparation } from "../types";
const validIds = (ids: string[]) => ids.every(id => id.trim()) && new Set(ids).size === ids.length;
export function parseResourceTask(value: unknown, expected: { taskId?: string; resourceId?: string } = {}): ResourceDownloadTask {
  if (!validateTask(value) || !value.id.trim() || !value.resourceId.trim() || !value.version.trim() ||
    !validIds(value.requestedByCapabilityIds) || !validIds(value.pendingActionIds) ||
    (expected.taskId !== undefined && value.id !== expected.taskId) || (expected.resourceId !== undefined && value.resourceId !== expected.resourceId)) {
    throw new Error("资源任务格式无效或与当前请求不匹配。");
  }
  return value;
}
export function parseResourceTasks(value: unknown): ResourceDownloadTask[] {
  if (!Array.isArray(value)) throw new Error("资源任务列表格式无效。");
  const tasks = value.map(task => parseResourceTask(task));
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error("资源任务列表包含重复任务。");
  return tasks;
}
export function parseCapabilityPreparation(value: unknown, capabilityId: string, pendingActionId: string | null): CapabilityPreparation {
  if (!validatePreparation(value) || value.capabilityId !== capabilityId || value.pendingActionId !== pendingActionId ||
    !validIds(value.resourceIds) || !validIds(value.readyResourceIds) || !validIds(value.taskIds) ||
    value.readyResourceIds.some(id => !value.resourceIds.includes(id)) ||
    (value.state === "ready" && (value.taskIds.length !== 0 || value.readyResourceIds.length !== value.resourceIds.length)) ||
    (value.state === "preparing" && value.taskIds.length === 0)) {
    throw new Error("功能准备状态无效或与当前操作不匹配。");
  }
  return value;
}
