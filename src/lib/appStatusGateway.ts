import { invoke } from "@tauri-apps/api/core";
import { browserStatus } from "./appMetadata";
import type { AppStatus } from "../generated/app-status";
export async function getAppStatus(): Promise<AppStatus> {
  if (!("__TAURI_INTERNALS__" in window)) return browserStatus;
  const value: unknown = await invoke("get_app_status");
  const { default: validate } = await import("../generated/app-status.validator.mjs");
  if (!validate(value) || value.appName !== "SiaoVPlay" || !value.version.trim() ||
    value.platform !== "windows-desktop" || !value.dataDirectory.trim() ||
    (value.startupMediaPath !== null && !value.startupMediaPath.trim())) throw new Error("应用启动状态不完整或不兼容，请重新启动应用。");
  return value;
}
