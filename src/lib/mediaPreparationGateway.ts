import { invoke } from "@tauri-apps/api/core";

import type { MediaPreparationProgress } from "../generated/media-preparation-progress";
import validateProgress from "../generated/media-preparation-progress.validator.mjs";
export type { MediaPreparationProgress } from "../generated/media-preparation-progress";

export async function getMediaPreparation(requestId: string): Promise<MediaPreparationProgress | null> {
  const value: unknown = await invoke("get_media_preparation", { requestId });
  if (value === null) return null;
  if (!validateProgress(value) || value.requestId !== requestId) throw new Error("视频准备状态格式无效");
  return value;
}
export async function cancelMediaPreparation(requestId: string): Promise<boolean> {
  return invoke("cancel_media_preparation", { requestId });
}
