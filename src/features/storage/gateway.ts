import { invoke } from "@tauri-apps/api/core";

import type { SaveStorageSettingsInput, StorageSettings } from "../../types";

export function getStorageSettings(): Promise<StorageSettings> {
  return invoke("get_storage_settings");
}

export function saveStorageSettings(
  input: SaveStorageSettingsInput,
): Promise<StorageSettings> {
  return invoke("save_storage_settings", { input });
}
