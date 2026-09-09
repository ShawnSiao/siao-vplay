import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export { getStorageSettings, saveStorageSettings } from "../../lib/storageSettingsGateway";
import type {
  StorageArea,
  StorageLocationKind,
  StorageMigrationMode,
  StorageMigrationTask,
} from "./types";

export async function chooseStorageDirectory(title: string): Promise<string | null> {
  const selected = await open({ multiple: false, directory: true, title });
  return typeof selected === "string" ? selected : null;
}

export async function prepareStorageMigration(
  area: StorageArea,
  destinationDirectory: string,
  mode: StorageMigrationMode,
): Promise<StorageMigrationTask> {
  const task = await parseMigration(await invoke<unknown>("prepare_storage_migration", {
    input: { area, destinationDirectory, mode },
  }), true);
  if (task.area !== area || task.mode !== mode || task.status !== "prepared") throw migrationError(true);
  return task;
}

export async function startStorageMigration(
  taskId: string,
): Promise<StorageMigrationTask> {
  const task = await parseMigration(await invoke<unknown>("start_storage_migration", { input: { taskId, confirmed: true } }), true);
  if (task.id !== taskId) throw migrationError(true);
  return task;
}

export async function resumeStorageMigration(
  taskId: string,
): Promise<StorageMigrationTask> {
  const task = await parseMigration(await invoke<unknown>("resume_storage_migration", { input: { taskId, confirmed: true } }), true);
  if (task.id !== taskId) throw migrationError(true);
  return task;
}

export async function getStorageMigration(taskId: string): Promise<StorageMigrationTask> {
  const task = await parseMigration(await invoke<unknown>("get_storage_migration", { input: { taskId } }), false);
  if (task.id !== taskId) throw migrationError(false);
  return task;
}

export async function getCurrentStorageMigration(): Promise<StorageMigrationTask | null> {
  const value = await invoke<unknown>("get_current_storage_migration");
  return value === null ? null : parseMigration(value, false);
}

export async function cancelStorageMigration(taskId: string): Promise<StorageMigrationTask> {
  const task = await parseMigration(await invoke<unknown>("cancel_storage_migration", { input: { taskId } }), true);
  if (task.id !== taskId) throw migrationError(true);
  return task;
}

export function openStorageLocation(kind: StorageLocationKind): Promise<void> {
  return invoke("open_storage_location", { input: { kind } });
}

export async function clearPlaybackCache(): Promise<{ reclaimedBytes: number }> {
  const value = await invoke<unknown>("clear_playback_cache", { input: { confirmed: true } });
  if (!value || typeof value !== "object" || !("reclaimedBytes" in value) ||
      typeof value.reclaimedBytes !== "number" || !Number.isSafeInteger(value.reclaimedBytes) ||
      value.reclaimedBytes < 0) {
    throw new Error("清理结果尚未确认，请刷新存储状态后检查。");
  }
  return { reclaimedBytes: value.reclaimedBytes };
}

export function restartAfterStorageMigration(): Promise<never> {
  return invoke("restart_after_storage_migration");
}

function migrationError(mutating: boolean): Error {
  return new Error(mutating ? "迁移操作结果尚未确认，请重新读取任务状态后再操作。" : "迁移任务格式或身份不匹配，未采用本次结果。");
}
async function parseMigration(value: unknown, mutating: boolean): Promise<StorageMigrationTask> {
  const { default: validate } = await import("../../generated/storage-migration-task.validator.mjs");
  if (!validate(value) || !value.id.trim() || !value.sourceRoot.trim() || !value.destinationRoot.trim()) throw migrationError(mutating);
  return value;
}
