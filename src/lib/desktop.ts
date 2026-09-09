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
  ExternalAgentTaskKind,
  LearningCard,
  LearningCardsExport,
  Project,
  RemoteMediaPreview,
  RuntimeCatalog,
  SubtitleExport,
  SubtitleExportFormat,
  SubtitleExportMode,
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

export async function getLocalResourceDiagnosticSummary(): Promise<string> {
  return invoke<string>("get_local_resource_diagnostic_summary");
}

export async function getLocalResourceThirdPartyNotices(): Promise<string> {
  return invoke<string>("get_local_resource_third_party_notices");
}




export async function getRuntimeCatalog(): Promise<RuntimeCatalog> {
  if (!isDesktopApp) {
    return {
      settings: {
        storageRoot: null,
        preferredModel: "small",
      },
      components: [],
    };
  }
  return invoke<RuntimeCatalog>("get_runtime_catalog");
}

export async function chooseRuntimeStorageRoot(): Promise<string | null> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: true,
    title: "选择运行时与模型存储目录",
  });
  return typeof selected === "string" ? selected : null;
}

export async function listProjects(): Promise<Project[]> {
  if (!isDesktopApp) {
    return [];
  }
  return invoke<Project[]>("list_projects");
}

export async function getProject(projectId: string): Promise<Project> {
  return invoke<Project>("get_project", { projectId });
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
  return invoke<Project>("open_local_project", { input: { mediaPath, title: null } });
}

export async function createLocalProject(mediaPath: string): Promise<Project> {
  return invoke<Project>("create_local_project", {
    input: { mediaPath, title: null },
  });
}

export async function inspectRemoteMediaUrl(
  url: string,
): Promise<RemoteMediaPreview> {
  return invoke<RemoteMediaPreview>("inspect_remote_media_url", {
    input: { url },
  });
}

export async function importRemoteMediaUrl(
  url: string,
  expectedPreviewToken: string,
  operationId: string,
): Promise<Project> {
  return invoke<Project>("import_remote_media_url", {
    input: {
      url,
      expectedPreviewToken,
      operationId,
      title: null,
    },
  });
}

export async function cancelRemoteMediaImport(
  operationId: string,
): Promise<boolean> {
  return invoke<boolean>("cancel_remote_media_import", {
    input: { operationId },
  });
}

export async function markProjectOpened(projectId: string): Promise<Project> {
  return invoke<Project>("mark_project_opened", { projectId });
}

export async function ensureProjectPoster(projectId: string): Promise<Project> {
  return invoke<Project>("ensure_project_poster", { projectId });
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

export async function openExternalResultDirectory(
  taskKind: ExternalAgentTaskKind,
  taskId: string,
): Promise<boolean> {
  return invoke<boolean>("open_external_result_directory", {
    taskKind,
    taskId,
  });
}

export async function createLearningCard(
  projectId: string,
  dictionaryEntryId: string,
): Promise<LearningCard> {
  return invoke<LearningCard>("create_learning_card", {
    input: { projectId, dictionaryEntryId },
  });
}

export async function getLearningCard(cardId: string): Promise<LearningCard> {
  return invoke<LearningCard>("get_learning_card", { cardId });
}

export async function listLearningCards(
  projectId: string,
): Promise<LearningCard[]> {
  return invoke<LearningCard[]>("list_learning_cards", { projectId });
}

export async function deleteLearningCard(
  projectId: string,
  cardId: string,
): Promise<boolean> {
  return invoke<boolean>("delete_learning_card", { projectId, cardId });
}

export async function exportLearningCards(
  projectId: string,
  destinationDirectory: string,
): Promise<LearningCardsExport> {
  return invoke<LearningCardsExport>("export_learning_cards", {
    input: { projectId, destinationDirectory },
  });
}

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

export async function exportSubtitles(
  projectId: string,
  mode: SubtitleExportMode,
  format: SubtitleExportFormat,
  sourceVersionId: string | null,
  translationVersionId: string | null,
  destinationDirectory: string,
): Promise<SubtitleExport> {
  return invoke<SubtitleExport>("export_subtitles", {
    input: {
      projectId,
      mode,
      format,
      sourceVersionId,
      translationVersionId,
      destinationDirectory,
      confirmVersionSelection: true,
    },
  });
}

export function playbackUrl(path: string): string {
  return isDesktopApp ? convertFileSrc(path) : "";
}

export { getMediaRuntimeStatus, getTranscriptionRuntimeStatus } from "./localRuntimeGateway";
