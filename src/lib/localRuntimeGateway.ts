import { invoke } from "@tauri-apps/api/core";
import type { MediaRuntimeStatus } from "../generated/media-runtime-status";
import type { TranscriptionRuntimeStatus } from "../generated/transcription-runtime-status";
export async function getMediaRuntimeStatus(): Promise<MediaRuntimeStatus> {
  if (!("__TAURI_INTERNALS__" in window)) return { available: false, ffmpegPath: null, ffprobePath: null, version: null, errorMessage: "浏览器预览不运行本地媒体工具" };
  const value: unknown = await invoke("get_media_runtime_status");
  const { default: validate } = await import("../generated/media-runtime-status.validator.mjs");
  if (!validate(value) || (value.available ? !value.ffmpegPath?.trim() || !value.ffprobePath?.trim() || !value.version?.trim() || value.errorMessage !== null : !value.errorMessage?.trim())) throw new Error("媒体工具检测结果不完整或不一致，请重新检测。");
  return value;
}
export async function getTranscriptionRuntimeStatus(): Promise<TranscriptionRuntimeStatus> {
  if (!("__TAURI_INTERNALS__" in window)) return { available: false, preferredBackend: null, runtimes: [], models: [] };
  const value: unknown = await invoke("get_transcription_runtime_status");
  const { default: validate } = await import("../generated/transcription-runtime-status.validator.mjs");
  if (!validate(value)) throw new Error("转写环境检测结果格式不完整，请重新检测。");
  const ready = value.runtimes.filter(item => item.available);
  if (new Set(value.runtimes.map(item => item.backend)).size !== value.runtimes.length ||
    new Set(value.models.map(item => item.modelKind)).size !== value.models.length ||
    value.runtimes.some(item => !["cpu", "vulkan"].includes(item.backend) || (item.available ? !item.path?.trim() || !item.version?.trim() || item.errorMessage !== null : !item.errorMessage?.trim())) ||
    value.models.some(item => !["small", "base"].includes(item.modelKind) || (item.available ? !item.path?.trim() || item.errorMessage !== null : !item.errorMessage?.trim())) ||
    (ready.length ? !ready.some(item => item.backend === value.preferredBackend) : value.preferredBackend !== null) ||
    value.available !== (ready.length > 0 && value.models.some(item => item.available))) throw new Error("转写环境检测结果不一致，请重新检测。");
  return value;
}
