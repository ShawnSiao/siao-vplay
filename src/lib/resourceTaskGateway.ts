import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { parseResourceTask, parseResourceSnapshot, parseCapabilityPreparation } from "./resourceTaskContract";
import type { ResourceDownloadTask, ResourceDownloadSnapshot, CapabilityPreparation } from "../types";

export async function listResourceDownloadTasks(): Promise<
  ResourceDownloadSnapshot
> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return { generation: 0, tasks: [] };
  }
  return parseResourceSnapshot(await invoke<unknown>("list_resource_download_tasks"));
}

export async function listenResourceDownloadTasks(listener: (task: ResourceDownloadTask) => void, onError: (cause: unknown) => void): Promise<UnlistenFn> {
  if (!("__TAURI_INTERNALS__" in window)) return () => undefined;
  return listen<unknown>("local-resource-task-updated", event => {
    let task: ResourceDownloadTask;
    try { task = parseResourceTask(event.payload); }
    catch (cause) { onError(cause); return; }
    listener(task);
  });
}

export async function prepareLocalCapability(
  capabilityId: string,
  pendingActionId?: string,
): Promise<CapabilityPreparation> {
  return parseCapabilityPreparation(await invoke<unknown>("prepare_local_capability", {
    input: { capabilityId, pendingActionId: pendingActionId ?? null },
  }), capabilityId, pendingActionId ?? null);
}

export async function pauseResourceDownload(
  taskId: string,
): Promise<ResourceDownloadTask> {
  return parseResourceTask(await invoke<unknown>("pause_resource_download", {
    input: { taskId },
  }), { taskId });
}

export async function resumeResourceDownload(
  taskId: string,
): Promise<ResourceDownloadTask> {
  return parseResourceTask(await invoke<unknown>("resume_resource_download", {
    input: { taskId },
  }), { taskId });
}

export async function cancelResourceDownload(
  taskId: string,
): Promise<ResourceDownloadTask> {
  return parseResourceTask(await invoke<unknown>("cancel_resource_download", {
    input: { taskId },
  }), { taskId });
}

export async function retryResourceDownload(
  taskId: string,
): Promise<ResourceDownloadTask> {
  return parseResourceTask(await invoke<unknown>("retry_resource_download", {
    input: { taskId },
  }), { taskId });
}

export async function repairLocalResource(
  resourceId: string,
): Promise<ResourceDownloadTask> {
  return parseResourceTask(await invoke<unknown>("repair_local_resource", {
    input: { resourceId },
  }), { resourceId });
}

export async function updateLocalResource(
  resourceId: string,
): Promise<ResourceDownloadTask> {
  return parseResourceTask(await invoke<unknown>("update_local_resource", {
    input: { resourceId },
  }), { resourceId });
}
