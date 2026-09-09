import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { LibraryScanProgress } from "../generated/library-scan-progress";
import validate from "../generated/library-scan-progress.validator.mjs";

export async function subscribeLibraryScanProgress(onProgress: (progress: LibraryScanProgress) => void): Promise<UnlistenFn> {
  return listen<unknown>("library-scan-progress", event => {
    if (validate(event.payload) && event.payload.scanId.trim()) onProgress(event.payload);
  });
}
