import validateSummaryDispatch from "../../generated/summary-dispatch-preview.validator.mjs";
import type { SummaryDispatchPreview } from "../../generated/summary-dispatch-preview";
import { invoke } from "@tauri-apps/api/core";

export type { SummaryDispatchPreview } from "../../generated/summary-dispatch-preview";

export async function previewSummaryDispatch(taskId: string): Promise<SummaryDispatchPreview> {
  const value = await invoke<unknown>("preview_summary_dispatch", { input: { taskId } });
  if (!validateSummaryDispatch(value)) throw new Error("总结发送清单无效，请重新准备材料。");
  if (!value || value.taskId !== taskId || !/^[0-9a-f]{64}$/.test(value.confirmationSha256) ||
      !["api", "codex", "manual"].includes(value.executionKind) ||
      !["current_progress", "full_video"].includes(value.scope) ||
      typeof value.receiver !== "string" || !value.receiver || typeof value.model !== "string" ||
      typeof value.subtitleVersionId !== "string" || typeof value.subtitleLanguage !== "string" ||
      !Number.isSafeInteger(value.subtitleVersionNumber) || value.subtitleVersionNumber < 1 || !Number.isSafeInteger(value.segmentCount) || value.segmentCount < 1 ||
      !Array.isArray(value.frames) || value.frames.length > 12 ||
      value.frames.some((frame) => typeof frame.id !== "string" || !Number.isSafeInteger(frame.timestampMs) || frame.timestampMs < 0 || !/^[0-9a-f]{64}$/.test(frame.sha256) || (value.scope === "current_progress" && frame.timestampMs > (value.playbackCutoffMs ?? -1))) ||
      ((value.firstStartMs === null) !== (value.lastEndMs === null)) ||
      (value.firstStartMs !== null && value.lastEndMs !== null && value.firstStartMs > value.lastEndMs) ||
      (value.scope === "current_progress" && (!Number.isSafeInteger(value.playbackCutoffMs) || (value.playbackCutoffMs ?? -1) < 0))) {
    throw new Error("总结发送清单无效，请重新准备材料。");
  }
  return value;
}
