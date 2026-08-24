import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type {
  SaveStorageSettingsInput,
  StorageSettings,
} from "../../types";
import type {
  StorageArea,
  StorageLocationKind,
  StorageMigrationMode,
  StorageMigrationTask,
} from "./types";

export function getStorageSettings(): Promise<StorageSettings> {
  return invoke("get_storage_settings");
}

export function saveStorageSettings(
  input: SaveStorageSettingsInput,
): Promise<StorageSettings> {
  return invoke("save_storage_settings", { input });
}

export async function chooseStorageDirectory(title: string): Promise<string | null> {
  const selected = await open({ multiple: false, directory: true, title });
  return typeof selected === "string" ? selected : null;
}

export function prepareStorageMigration(
  area: StorageArea,
  destinationDirectory: string,
  mode: StorageMigrationMode,
): Promise<StorageMigrationTask> {
  return invoke("prepare_storage_migration", {
    input: { area, destinationDirectory, mode },
  });
}

export function startStorageMigration(
  taskId: string,
): Promise<StorageMigrationTask> {
  return invoke("start_storage_migration", { input: { taskId, confirmed: true } });
}

export function resumeStorageMigration(
  taskId: string,
): Promise<StorageMigrationTask> {
  return invoke("resume_storage_migration", { input: { taskId, confirmed: true } });
}

export function getStorageMigration(taskId: string): Promise<StorageMigrationTask> {
  return invoke("get_storage_migration", { input: { taskId } });
}

export function getCurrentStorageMigration(): Promise<StorageMigrationTask | null> {
  return invoke("get_current_storage_migration");
}

export function cancelStorageMigration(taskId: string): Promise<StorageMigrationTask> {
  return invoke("cancel_storage_migration", { input: { taskId } });
}

export function openStorageLocation(kind: StorageLocationKind): Promise<void> {
  return invoke("open_storage_location", { input: { kind } });
}

export function clearPlaybackCache(): Promise<{ reclaimedBytes: number }> {
  return invoke("clear_playback_cache", { input: { confirmed: true } });
}

export function restartAfterStorageMigration(): Promise<never> {
  return invoke("restart_after_storage_migration");
}
