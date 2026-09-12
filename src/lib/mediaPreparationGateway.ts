import { invoke } from "@tauri-apps/api/core";

import type { MediaPreparationProgress } from "../generated/media-preparation-progress";
import validateProgress from "../generated/media-preparation-progress.validator.mjs";
export type { MediaPreparationProgress } from "../generated/media-preparation-progress";
import type { MediaPreparation } from "../generated/media-preparation-result";
import validateResult from "../generated/media-preparation-result.validator.mjs";

export async function prepareProjectMedia(projectId: string, forceProxy: boolean, requestId?: string): Promise<MediaPreparation> {
  const value: unknown = await invoke("prepare_project_media", { input: { projectId, forceProxy }, requestId });
  const invalid = () => new Error("视频准备结果无效，请重新准备视频");
  if (!validateResult(value) || value.inspection.projectId !== projectId || !value.playbackPath.trim()) throw invalid();
  if (value.playbackSourceKind === "proxy") {
    const artifact = value.proxyArtifact;
    if (!artifact || artifact.projectId !== projectId || artifact.sourceMediaId !== value.inspection.mediaSourceId
      || artifact.sourceSha256 !== value.inspection.sourceSha256 || artifact.status !== "completed"
      || artifact.path !== value.playbackPath) throw invalid();
  } else if (value.proxyArtifact !== null || value.reusedProxy) throw invalid();
  return value;
}

export async function getMediaPreparation(requestId: string): Promise<MediaPreparationProgress | null> {
  const value: unknown = await invoke("get_media_preparation", { requestId });
  if (value === null) return null;
  if (!validateProgress(value) || value.requestId !== requestId) throw new Error("视频准备状态格式无效");
  return value;
}
export async function cancelMediaPreparation(requestId: string): Promise<boolean> {
  const value = await invoke<unknown>("cancel_media_preparation", { requestId });
  if (typeof value !== "boolean") throw new Error("取消视频准备的结果尚未确认，请重新读取任务状态。");
  return value;
}
