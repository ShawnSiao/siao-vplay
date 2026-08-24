import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { StorageSettings } from "../../types";

export type StorageDirectoryKind = "subtitle" | "video" | "report";

export async function chooseConfiguredStorageDirectory(
  kind: StorageDirectoryKind,
  title: string,
): Promise<string | null> {
  const settings = await invoke<StorageSettings>("get_storage_settings");
  const defaultPath = kind === "subtitle"
    ? settings.defaultSubtitleExportDirectory
    : settings.defaultVideoReportExportDirectory;
  const selected = await open({
    multiple: false,
    directory: true,
    title,
    defaultPath: defaultPath ?? undefined,
  });
  return typeof selected === "string" ? selected : null;
}
