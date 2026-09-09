import { getStorageSettings } from "./storageSettingsGateway";
import { open } from "@tauri-apps/plugin-dialog";


export type StorageDirectoryKind = "subtitle" | "video" | "report";

export async function chooseConfiguredStorageDirectory(
  kind: StorageDirectoryKind,
  title: string,
): Promise<string | null> {
  const settings = await getStorageSettings();
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
