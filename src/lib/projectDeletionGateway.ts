import { invoke } from "@tauri-apps/api/core";
import type { DeleteProjectResult } from "../generated/delete-project-result";
import validate from "../generated/delete-project-result.validator.mjs";
import type { PendingProjectCleanup } from "../generated/pending-project-cleanup";
import validatePending from "../generated/pending-project-cleanup.validator.mjs";

export async function getPendingProjectCleanup(): Promise<PendingProjectCleanup | null> {
  const value: unknown = await invoke("get_pending_project_cleanup");
  if (value === null) return null;
  if (!validatePending(value) || !value.projectId.trim()) throw new Error("待清理状态格式无效");
  return value;
}

export async function deleteProject(projectId: string): Promise<DeleteProjectResult> {
  const value: unknown = await invoke("delete_project", { projectId });
  if (!validate(value) || value.projectId !== projectId || value.sourceMediaDeleted) {
    throw new Error("删除结果格式无效，请刷新媒体库确认项目状态");
  }
  return value;
}
