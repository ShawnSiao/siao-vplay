import metadata from "../../release.json";
import type { AppStatus } from "../types";

/** Release metadata is checked against Cargo, Tauri and npm by check:release. */
export const appMetadata = metadata;

export const browserStatus: AppStatus = {
  appName: "SiaoVPlay", interruptedTranscriptionCount: 0,
  version: appMetadata.version,
  platform: "browser-preview",
  dataDirectory: "仅桌面应用可用",
  startupMediaPath: null,
};
