import { invoke } from "@tauri-apps/api/core";
import type { ExternalAgentResultUpdate } from "../generated/external-agent-result-update";

type Validator = (value: unknown) => value is ExternalAgentResultUpdate;
const invalidResult = () => new Error("外部结果通知不完整或不兼容，尚未确认该结果。");
function isValidUpdate(value: unknown, validate: Validator): value is ExternalAgentResultUpdate {
  if (!validate(value) || !value.taskId.trim() || !value.projectId.trim() || !value.message.trim()) return false;
  return value.status === "completed"
    ? value.outputId !== null && !!value.outputId.trim()
    : value.outputId === null;
}

export async function reconcileExternalAgentResults(): Promise<ExternalAgentResultUpdate[]> {
  if (!("__TAURI_INTERNALS__" in window)) return [];
  const value: unknown = await invoke("reconcile_external_agent_results");
  if (!Array.isArray(value)) throw invalidResult();
  const { default: validate } = await import("../generated/external-agent-result-update.validator.mjs");
  // Invalid receipts are never acknowledged; durable completed items remain replayable.
  const valid = value.filter((item): item is ExternalAgentResultUpdate => isValidUpdate(item, validate));
  if (value.length && !valid.length) throw invalidResult();
  return valid;
}

export async function acknowledgeExternalAgentResults(updates: ExternalAgentResultUpdate[]): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const snapshot = updates.map(update => ({ ...update }));
  const { default: validate } = await import("../generated/external-agent-result-update.validator.mjs");
  if (snapshot.some(update => !isValidUpdate(update, validate))) throw invalidResult();
  const completed = snapshot.filter(update => update.status === "completed");
  if (completed.length) await invoke<void>("acknowledge_external_agent_results", { updates: completed });
}

export async function openExternalResultDirectory(taskKind: import("../types").ExternalAgentTaskKind, taskId: string): Promise<boolean> {
  const value = await invoke<unknown>("open_external_result_directory", { taskKind, taskId });
  if (typeof value !== "boolean") throw new Error("打开结果目录的响应无效，请重试。");
  return value;
}
