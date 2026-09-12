import { invoke } from "@tauri-apps/api/core";
import type { StorageSettingsView } from "../generated/storage-settings";
import type { SaveStorageSettingsInput } from "../generated/save-storage-settings-input";

async function parseSettings(value: unknown): Promise<StorageSettingsView> {
  const { default: validate } = await import("../generated/storage-settings.validator.mjs");
  if (!validate(value) || !value.appDataRoot.trim() || !value.remoteMediaRoot.trim() || !value.mediaCacheRoot.trim() ||
      [value.defaultSubtitleExportDirectory, value.defaultVideoReportExportDirectory, value.pendingAppDataRoot].some(path => path !== null && !path.trim())) {
    throw new Error("存储设置格式不完整，未采用本次结果。");
  }
  return value;
}

export async function getStorageSettings(): Promise<StorageSettingsView> {
  return parseSettings(await invoke<unknown>("get_storage_settings"));
}

export async function saveStorageSettings(input: SaveStorageSettingsInput): Promise<StorageSettingsView> {
  const snapshot = { ...input };
  const { default: validate } = await import("../generated/save-storage-settings-input.validator.mjs");
  if (!validate(snapshot)) throw new Error("存储设置保存参数不完整，未执行保存。");
  const result = await invoke<unknown>("save_storage_settings", { input: snapshot });
  try {
    const next = await parseSettings(result);
    if (next.revision !== snapshot.expectedRevision + 1 ||
        next.remoteMediaUsesDefault !== !snapshot.remoteMediaRoot?.trim() ||
        next.mediaCacheUsesDefault !== !snapshot.mediaCacheRoot?.trim() ||
        (next.defaultSubtitleExportDirectory === null) !== !snapshot.defaultSubtitleExportDirectory?.trim() ||
        (next.defaultVideoReportExportDirectory === null) !== !snapshot.defaultVideoReportExportDirectory?.trim()) throw new Error();
    return next;
  } catch {
    throw new Error("存储设置保存结果尚未确认。请先重新读取设置，再决定是否保存；当前编辑内容仍保留。");
  }
}
