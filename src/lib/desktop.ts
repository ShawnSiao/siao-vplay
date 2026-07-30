import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type {
  AppStatus,
  DeleteProjectResult,
  DesktopCommandError,
  MediaPreparation,
  MediaRuntimeStatus,
  Project,
  SubtitleImportPreview,
  SubtitleVersion,
} from "../types";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;

const browserStatus: AppStatus = {
  appName: "SiaoVPlay",
  version: "0.1.0",
  platform: "browser-preview",
  dataDirectory: "仅桌面应用可用",
  startupMediaPath: null,
};

export function commandError(error: unknown): DesktopCommandError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  ) {
    return {
      code: String(error.code),
      message: String(error.message),
    };
  }
  if (error instanceof Error) {
    return { code: "unexpected_error", message: error.message };
  }
  return { code: "unexpected_error", message: String(error) };
}

export async function getAppStatus(): Promise<AppStatus> {
  if (!isDesktopApp) {
    return browserStatus;
  }
  return invoke<AppStatus>("get_app_status");
}

export async function getMediaRuntimeStatus(): Promise<MediaRuntimeStatus> {
  if (!isDesktopApp) {
    return {
      available: false,
      ffmpegPath: null,
      ffprobePath: null,
      version: null,
      errorMessage: "浏览器预览不运行本地媒体工具",
    };
  }
  return invoke<MediaRuntimeStatus>("get_media_runtime_status");
}

export async function listProjects(): Promise<Project[]> {
  if (!isDesktopApp) {
    return [];
  }
  return invoke<Project[]>("list_projects");
}

export async function chooseLocalVideo(): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择本地视频",
    filters: [
      {
        name: "视频文件",
        extensions: [
          "mp4",
          "mkv",
          "mov",
          "webm",
          "avi",
          "m4v",
          "ts",
          "mts",
          "m2ts",
        ],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export async function createLocalProject(mediaPath: string): Promise<Project> {
  return invoke<Project>("create_local_project", {
    input: { mediaPath, title: null },
  });
}

export async function markProjectOpened(projectId: string): Promise<Project> {
  return invoke<Project>("mark_project_opened", { projectId });
}

export async function prepareProjectMedia(
  projectId: string,
  forceProxy: boolean,
): Promise<MediaPreparation> {
  return invoke<MediaPreparation>("prepare_project_media", {
    input: { projectId, forceProxy },
  });
}

export async function ensureProjectPoster(projectId: string): Promise<Project> {
  return invoke<Project>("ensure_project_poster", { projectId });
}

export async function updatePlaybackState(
  projectId: string,
  values: {
    positionMs: number;
    durationMs: number | null;
    volume: number;
    playbackRate: number;
  },
): Promise<Project> {
  return invoke<Project>("update_playback_state", {
    input: { projectId, ...values },
  });
}

export async function relinkProjectMedia(
  projectId: string,
  mediaPath: string,
): Promise<Project> {
  return invoke<Project>("relink_project_media", {
    input: { projectId, mediaPath },
  });
}

export async function deleteProject(
  projectId: string,
): Promise<DeleteProjectResult> {
  return invoke<DeleteProjectResult>("delete_project", { projectId });
}

export async function inspectSubtitleFile(
  projectId: string,
  subtitlePath: string,
  languageCode: string,
): Promise<SubtitleImportPreview> {
  return invoke<SubtitleImportPreview>("inspect_subtitle_file", {
    input: { projectId, subtitlePath, languageCode },
  });
}

export async function importSubtitleFile(
  projectId: string,
  subtitlePath: string,
  languageCode: string,
  preview: Pick<
    SubtitleImportPreview,
    | "sourceSha256"
    | "expectedMediaSha256"
    | "expectedProjectRevision"
  >,
): Promise<SubtitleVersion> {
  return invoke<SubtitleVersion>("import_subtitle_file", {
    input: {
      projectId,
      subtitlePath,
      languageCode,
      expectedSourceSha256: preview.sourceSha256,
      expectedMediaSha256: preview.expectedMediaSha256,
      expectedProjectRevision: preview.expectedProjectRevision,
    },
  });
}

export async function listSubtitleVersions(
  projectId: string,
): Promise<SubtitleVersion[]> {
  return invoke<SubtitleVersion[]>("list_subtitle_versions", { projectId });
}

export function playbackUrl(path: string): string {
  return isDesktopApp ? convertFileSrc(path) : "";
}
