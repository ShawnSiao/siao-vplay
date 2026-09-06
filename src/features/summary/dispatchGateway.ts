import { invoke } from "@tauri-apps/api/core";
import type { SummaryScope } from "./types";

export type SummaryDispatchPreview = {
  taskId: string;
  confirmationSha256: string;
  executionKind: "api" | "codex" | "manual";
  receiver: string;
  endpoint: string | null;
  model: string;
  scope: SummaryScope;
  playbackCutoffMs: number | null;
  subtitleVersionId: string;
  subtitleVersionNumber: number;
  subtitleRole: string;
  subtitleLanguage: string;
  segmentCount: number;
  firstStartMs: number | null;
  lastEndMs: number | null;
  promptTemplate: string;
  oneTimeRequirements: string;
  frames: Array<{ id: string; timestampMs: number; sha256: string }>;
};

export async function previewSummaryDispatch(taskId: string): Promise<SummaryDispatchPreview> {
  const value = await invoke<SummaryDispatchPreview>("preview_summary_dispatch", { input: { taskId } });
  if (!value || value.taskId !== taskId || !/^[0-9a-f]{64}$/.test(value.confirmationSha256) ||
      !["api", "codex", "manual"].includes(value.executionKind) ||
      !["current_progress", "full_video"].includes(value.scope) ||
      typeof value.receiver !== "string" || !value.receiver || typeof value.model !== "string" ||
      typeof value.subtitleVersionId !== "string" || typeof value.subtitleLanguage !== "string" ||
      !Number.isSafeInteger(value.subtitleVersionNumber) || !Number.isSafeInteger(value.segmentCount) || value.segmentCount < 1 ||
      !Array.isArray(value.frames) || value.frames.length > 12 ||
      value.frames.some((frame) => typeof frame.id !== "string" || !Number.isSafeInteger(frame.timestampMs) || frame.timestampMs < 0) ||
      (value.scope === "current_progress" && (!Number.isSafeInteger(value.playbackCutoffMs) || (value.playbackCutoffMs ?? -1) < 0))) {
    throw new Error("总结发送清单无效，请重新准备材料。");
  }
  return value;
}
