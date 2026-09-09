import { invokeProject, readProjectList } from "./projectGateway";
export { reconcileExternalAgentResults, acknowledgeExternalAgentResults } from "./externalResultGateway";
export { retryLocalResourceBinding, inspectLocalResourceBinding } from "./resourceLocationGateway";
export { planLocalResourceLocation, planLocalResourceMove, moveLocalResourceRoot, inspectLocalResourceMigration, adoptLocalResources } from "./resourceMigrationGateway";
export { getLocalResourceCatalog } from "./resourceCatalogGateway";
export { getLocalResourceDiagnostics } from "./resourceDiagnosticsGateway";
export { planUnusedResourceCleanup, cleanupUnusedResources, removeLocalResource, rollbackLocalResource, planOldResourceVersionCleanup, cleanupOldResourceVersions } from "./resourceMaintenanceGateway";
export { getLocalResourceStatus, configureLocalResourceRoot, repairLocalResourceRoot, reconnectLocalResourceRoot, setLocalResourceProfile, getLocalResourceNetworkStatus, setLocalResourceProxy } from "./resourceStatusGateway";
export { listResourceDownloadTasks, listenResourceDownloadTasks, prepareLocalCapability, pauseResourceDownload, resumeResourceDownload, cancelResourceDownload, retryResourceDownload, repairLocalResource, updateLocalResource } from "./resourceTaskGateway";
export { startSubtitleBurn, getSubtitleBurnJob, listSubtitleBurnJobs, cancelSubtitleBurnJob, resumeSubtitleBurnJob } from "./burnGateway";
export { commandError } from "./commandError";
export { prepareExplanationTask, getExplanationTask, listExplanationTasks, readExplanationPrompt, openExplanationMaterials, getExplanation, listExplanations, importExplanationResult, startCodexExplanationTask, cancelExplanationTask, resumeCodexExplanationTask } from "./explanationGateway";
export { prepareLearningTask, getLearningTask, listLearningTasks, readLearningPrompt, importLearningResult, startCodexLearningTask, cancelLearningTask, resumeCodexLearningTask } from "./learningGateway";
export { getDictionaryEntry, listDictionaryEntries } from "./dictionaryGateway";
export { prepareTranslationTask, getTranslationTask, listTranslationTasks, readTranslationPrompt, importTranslationResult, startCodexTranslationTask, cancelTranslationTask, resumeCodexTranslationTask } from "./translationGateway";
export { inspectSubtitleFile, importSubtitleFile, listSubtitleVersions, getSubtitleVersion, listSubtitleVersionMetadata, reviseSubtitleVersion, restoreSubtitleVersion, inspectEmbeddedSubtitle, importEmbeddedSubtitle } from "./subtitleGateway";
export { inspectYouTubeUrl, importYouTubeUrl, cancelYouTubeImport, getPublicResolverDisclosure } from "./publicVideoGateway";
export { getMediaPreparation, cancelMediaPreparation, prepareProjectMedia } from "./mediaPreparationGateway";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { supportedVideoExtensions } from "./mediaFiles";
import { chooseConfiguredStorageDirectory } from "./storageDirectoryPicker";

import type {
  Project,
} from "../types";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;


export { getAppStatus } from "./appStatusGateway";

export async function setMainWindowMediaTitle(
  mediaTitle: string | null,
): Promise<void> {
  if (!isDesktopApp) {
    return;
  }
  await invoke("set_main_window_media_title", { mediaTitle });
}



export async function chooseLocalResourceParent(): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择本地功能资源保存位置",
  });
  return typeof selected === "string" ? selected : null;
}

export { getLocalResourceDiagnosticSummary, getLocalResourceThirdPartyNotices } from "./resourceDiagnosticsGateway";

export async function listProjects(): Promise<Project[]> {
  if (!isDesktopApp) {
    return [];
  }
  return readProjectList();
}

export async function getProject(projectId: string): Promise<Project> {
  return invokeProject("get_project", { projectId });
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
        extensions: [...supportedVideoExtensions],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseLocalFolder(): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: true,
    title: "选择剧集文件夹",
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseSubtitleFile(): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择原文字幕",
    filters: [
      {
        name: "字幕文件",
        extensions: ["srt", "vtt"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export async function openLocalProject(mediaPath: string): Promise<Project> {
  return invokeProject("open_local_project", { input: { mediaPath, title: null } });
}

export async function createLocalProject(mediaPath: string): Promise<Project> {
  return invokeProject("create_local_project", {
    input: { mediaPath, title: null },
  });
}

export { inspectRemoteMediaUrl, cancelRemoteMediaImport } from "./remoteMediaGateway";

export async function importRemoteMediaUrl(
  url: string,
  expectedPreviewToken: string,
  operationId: string,
): Promise<Project> {
  return invokeProject("import_remote_media_url", {
    input: {
      url,
      expectedPreviewToken,
      operationId,
      title: null,
    },
  });
}

export async function markProjectOpened(projectId: string): Promise<Project> {
  return invokeProject("mark_project_opened", { projectId });
}

export async function ensureProjectPoster(projectId: string): Promise<Project> {
  return invokeProject("ensure_project_poster", { projectId });
}

export async function updatePlaybackState(
  projectId: string,
  values: {
    completed?: boolean;
    positionMs: number;
    durationMs: number | null;
    volume: number;
    playbackRate: number;
    subtitleMode: "original" | "translation" | "bilingual";
  },
): Promise<Project> {
  return invokeProject("update_playback_state", {
    input: { projectId, ...values },
  });
}

export async function relinkProjectMedia(
  projectId: string,
  mediaPath: string,
): Promise<Project> {
  return invokeProject("relink_project_media", {
    input: { projectId, mediaPath },
  });
}

export { deleteProject } from "./projectDeletionGateway";

export { startTranscription, getTranscriptionJob, listTranscriptionJobs, cancelTranscriptionJob, resumeTranscriptionJob } from "./transcriptionGateway";

export async function chooseTranslationResultFile(): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择 Agent 返回的翻译结果",
    filters: [
      {
        name: "JSON 结果",
        extensions: ["json"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}






export { getCodexRuntimeStatus } from "./codexRuntimeGateway";




export async function chooseExplanationResultFile(): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择场景解释结果",
    filters: [
      {
        name: "JSON 结果",
        extensions: ["json"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}


export async function chooseLearningResultFile(): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择词义查询结果",
    filters: [
      {
        name: "JSON 结果",
        extensions: ["json"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export async function chooseLearningExportDirectory(): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: true,
    title: "选择学习卡片导出位置",
  });
  return typeof selected === "string" ? selected : null;
}

export { openExternalResultDirectory } from "./externalResultGateway";

export { createLearningCard, getLearningCard, listLearningCards, deleteLearningCard, exportLearningCards } from "./learningCardGateway";

export async function chooseSubtitleDeliveryDirectory(
  outputKind: "subtitle" | "video" = "subtitle",
): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  return chooseConfiguredStorageDirectory(
    outputKind,
    "选择字幕或烧录视频保存位置",
  );
}

export { exportSubtitles } from "./subtitleExportGateway";

export function playbackUrl(path: string): string {
  return isDesktopApp ? convertFileSrc(path) : "";
}

export { getMediaRuntimeStatus, getTranscriptionRuntimeStatus } from "./localRuntimeGateway";
