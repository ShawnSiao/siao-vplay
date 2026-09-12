import validateTask from "../generated/translation-task.validator.mjs";
import validateApplication from "../generated/translation-application.validator.mjs";
import type { TranslationApplication, TranslationTask, TranslationValidation } from "../types";
import { parseSubtitleBody } from "./subtitleBodyContract";

type Expected = { taskId?: string; projectId?: string; handoffKind?: TranslationTask["handoffKind"] };
function validValidation(value: TranslationValidation, count: number) {
  return value.translationCount === count && value.warningCount === value.warnings.length &&
    (value.status === "accepted" ? value.warningCount === 0 : value.warningCount > 0);
}
export function parseTranslationTask(value: unknown, expected: Expected = {}): TranslationTask {
  if (!validateTask(value) || !value.id.trim() || !value.projectId.trim() || !value.sourceVersionId.trim() ||
    (expected.taskId !== undefined && value.id !== expected.taskId) ||
    (expected.projectId !== undefined && value.projectId !== expected.projectId) ||
    (expected.handoffKind !== undefined && value.handoffKind !== expected.handoffKind) ||
    (value.baseTranslationVersionId !== null && !value.baseTranslationVersionId.trim()) ||
    (value.outputVersionId !== null && !value.outputVersionId.trim()) ||
    value.authorizedSegmentIds.some(id => !id.trim()) ||
    new Set(value.authorizedSegmentIds).size !== value.segmentCount || value.authorizedSegmentIds.length !== value.segmentCount ||
    (value.validation !== null && !validValidation(value.validation, value.segmentCount))) {
    throw new Error("翻译任务格式无效或与当前请求不匹配。");
  }
  return value;
}
export function parseTranslationTasks(value: unknown, projectId: string): TranslationTask[] {
  if (!Array.isArray(value)) throw new Error("翻译任务列表格式无效。");
  const tasks = value.map(task => parseTranslationTask(task, { projectId }));
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error("翻译任务列表包含重复任务。");
  return tasks;
}
export function parseTranslationApplication(value: unknown, taskId: string): TranslationApplication {
  if (!validateApplication(value)) throw new Error("翻译结果格式无效。");
  const task = parseTranslationTask(value.task, { taskId });
  if (task.status !== "completed" || !task.outputVersionId || !task.validation) throw new Error("翻译任务尚未完成或缺少输出版本。");
  const version = parseSubtitleBody(value.subtitleVersion, task.projectId, task.outputVersionId);
  const validation = value.validation;
  if (version.role !== "translation" || version.sourceKind !== "agent_translation" || version.sourceTaskId !== task.id ||
    version.languageCode !== task.targetLanguageCode || !validValidation(validation, task.segmentCount) ||
    validation.status !== task.validation.status || validation.warningCount !== task.validation.warningCount ||
    validation.warnings.some((warning, index) => warning !== task.validation?.warnings[index])) {
    throw new Error("翻译结果与任务或校验记录不匹配。");
  }
  const sourceIds = version.segments.map(segment => segment.sourceSegmentId);
  const covered = new Set(sourceIds);
  if (sourceIds.some(id => id === null || !id.trim()) || covered.size !== sourceIds.length) {
    throw new Error("翻译结果的原文分段关联无效或重复。");
  }
  const authorized = new Set(task.authorizedSegmentIds);
  if (task.authorizedSegmentIds.some(id => !covered.has(id))) throw new Error("翻译结果缺少已授权的字幕分段。");
  if (task.baseTranslationVersionId === null && sourceIds.some(id => !authorized.has(id ?? ""))) {
    throw new Error("新译文包含未授权的字幕分段。");
  }
  return value;
}
