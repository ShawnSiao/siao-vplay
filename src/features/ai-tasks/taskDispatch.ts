import { invoke } from "@tauri-apps/api/core";
import type { ExplanationTask, LearningTask } from "../../types";
import type { AiExecutionTarget, AiMaterialAuthorization } from "../environment-settings/types";
import { resumeExplanationTask, resumeLearningTask } from "./gateway";
import {
  startCodexExplanationTask, resumeCodexExplanationTask,
  startCodexLearningTask, resumeCodexLearningTask,
} from "../../lib/desktop";

export type TaskDispatchPreview = {
  taskId: string;
  taskKind: "explanation" | "learning";
  confirmationSha256: string;
  execution: AiExecutionTarget;
  authorization: AiMaterialAuthorization;
  receiver: string;
  endpoint: string | null;
  model: string;
  subtitles: Array<{ versionId: string; versionNumber: number; role: string; language: string }>;
  subtitleCount: number;
  playbackCutoffMs: number;
  selectedText: string | null;
  prompt: { template: string; requirements: string; oneTimeRequirements: string } | null;
  frames: Array<{ id: string; timestampMs: number; sha256: string }>;
};

const hash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const text = (value: unknown) => typeof value === "string" && value.length > 0;
const time = (value: number) => Number.isSafeInteger(value) && value >= 0;

export async function previewTaskDispatch(taskKind: TaskDispatchPreview["taskKind"], taskId: string) {
  const value = await invoke<TaskDispatchPreview>("preview_ai_task_dispatch", { input: { taskKind, taskId } });
  if (!value || value.taskId !== taskId || value.taskKind !== taskKind || !hash(value.confirmationSha256) ||
      !value.execution || !["api", "codex", "manual"].includes(value.execution.kind) ||
      (value.execution.kind === "api" && (!text(value.execution.serviceConfigId) || !text(value.execution.modelId))) ||
      !value.authorization || value.authorization.subtitles !== true || value.authorization.currentQuestion !== true ||
      typeof value.authorization.frames !== "boolean" ||
      !(value.authorization.serviceRevision === null || time(value.authorization.serviceRevision)) ||
      !text(value.receiver) || !text(value.model) || !(value.endpoint === null || text(value.endpoint)) ||
      !(value.selectedText === null || text(value.selectedText)) ||
      !(value.prompt === null || (value.prompt && text(value.prompt.template) && typeof value.prompt.requirements === "string" && typeof value.prompt.oneTimeRequirements === "string")) ||
      !time(value.playbackCutoffMs) || !Number.isSafeInteger(value.subtitleCount) || value.subtitleCount < 1 ||
      !Array.isArray(value.subtitles) || value.subtitles.length < 1 || value.subtitles.length > 2 ||
      value.subtitles.some((item) => !item || !text(item.versionId) || !text(item.language) || !text(item.role) || !Number.isSafeInteger(item.versionNumber) || item.versionNumber < 1) ||
      !Array.isArray(value.frames) || value.frames.length > 6 ||
      value.frames.some((item) => !item || !text(item.id) || !hash(item.sha256) || !time(item.timestampMs) || item.timestampMs > value.playbackCutoffMs) ||
      value.authorization.frames !== (value.frames.length > 0)) {
    throw new Error("发送清单无效，请重新准备材料。");
  }
  return value;
}

export async function executeExplanationDispatch(task: ExplanationTask, preview: TaskDispatchPreview) {
  if (preview.taskId !== task.id || preview.taskKind !== "explanation") throw new Error("任务已改变，请重新确认。");
  if (preview.execution.kind === "api") return resumeExplanationTask(task.id, preview.execution, preview.authorization, preview.confirmationSha256);
  if (preview.execution.kind === "manual") return task;
  const run = task.status === "queued" ? startCodexExplanationTask : resumeCodexExplanationTask;
  return run(task.id, undefined, preview.confirmationSha256);
}

export async function executeLearningDispatch(task: LearningTask, preview: TaskDispatchPreview) {
  if (preview.taskId !== task.id || preview.taskKind !== "learning") throw new Error("任务已改变，请重新确认。");
  if (preview.execution.kind === "api") return resumeLearningTask(task.id, preview.execution, preview.authorization, preview.confirmationSha256);
  if (preview.execution.kind === "manual") return task;
  const run = task.status === "queued" ? startCodexLearningTask : resumeCodexLearningTask;
  return run(task.id, undefined, preview.confirmationSha256);
}
