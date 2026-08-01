import { useEffect, useState } from "react";

import { isSupportedVideoPath } from "../../lib/mediaFiles";

export type MediaDropFeedback = {
  tone: "ready" | "blocked" | "working";
  message: string;
};

type UseDesktopMediaDropOptions = {
  enabled: boolean;
  onImportMedia: (path: string) => Promise<void>;
  onNotice: (message: string) => void;
};

function classifyPaths(paths: string[]): MediaDropFeedback {
  if (paths.length !== 1) {
    return { tone: "blocked", message: "一次只能导入一个视频" };
  }
  if (!isSupportedVideoPath(paths[0])) {
    return {
      tone: "blocked",
      message: "暂不支持文件夹或这种文件；文件夹导入将在 Phase 7D 启用",
    };
  }
  return { tone: "ready", message: "松开以导入这个视频" };
}

export function useDesktopMediaDrop({
  enabled,
  onImportMedia,
  onNotice,
}: UseDesktopMediaDropOptions) {
  const [feedback, setFeedback] = useState<MediaDropFeedback | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/webview")
      .then(async ({ getCurrentWebview }) => {
        if (disposed) {
          return;
        }
        unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
          if (payload.type === "enter") {
            setFeedback(classifyPaths(payload.paths));
            return;
          }
          if (payload.type === "leave") {
            setFeedback(null);
            return;
          }
          if (payload.type !== "drop") {
            return;
          }
          const result = classifyPaths(payload.paths);
          if (result.tone === "blocked") {
            setFeedback(result);
            onNotice(result.message);
            window.setTimeout(() => setFeedback(null), 1_800);
            return;
          }
          const [path] = payload.paths;
          setFeedback({ tone: "working", message: "正在导入视频…" });
          void onImportMedia(path).finally(() => setFeedback(null));
        });
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled, onImportMedia, onNotice]);

  return feedback;
}
