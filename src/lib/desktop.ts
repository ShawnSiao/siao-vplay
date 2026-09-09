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
export { getMediaPreparation, cancelMediaPreparation } from "./mediaPreparationGateway";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { supportedVideoExtensions } from "./mediaFiles";
import { browserStatus } from "./appMetadata";
import { chooseConfiguredStorageDirectory } from "./storageDirectoryPicker";

import type {
  AppStatus,
  DeleteProjectResult,
  ExternalAgentResultUpdate,
  ExternalAgentTaskKind,
  LearningCard,
  LearningCardsExport,
  LocalResourceLocationPlan,
  LocalResourceMovePlan,
  LocalResourceMoveResult,
  MediaPreparation,
  MediaRuntimeStatus,
  Project,
  RemoteMediaPreview,
  RuntimeCatalog,
  ResourceAdoptionResult,
  ResourceMigrationPreview,
  SubtitleExport,
  SubtitleExportFormat,
  SubtitleExportMode,
  TranscriptionRuntimeStatus,
  CodexRuntimeStatus,
} from "../types";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;


export async function getAppStatus(): Promise<AppStatus> {
  if (!isDesktopApp) {
    return browserStatus;
  }
  return invoke<AppStatus>("get_app_status");
}

export async function setMainWindowMediaTitle(
  mediaTitle: string | null,
): Promise<void> {
  if (!isDesktopApp) {
    return;
  }
  await invoke("set_main_window_media_title", { mediaTitle });
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

export async function planLocalResourceLocation(
  parentPath: string,
): Promise<LocalResourceLocationPlan> {
  return invoke<LocalResourceLocationPlan>("plan_local_resource_location", {
    input: { parentPath },
  });
}



export async function inspectLocalResourceMigration(
  sourcePath?: string,
): Promise<ResourceMigrationPreview> {
  return invoke<ResourceMigrationPreview>("inspect_local_resource_migration", {
    input: {
      sourcePath: sourcePath ?? null,
      sourceKind: sourcePath ? "selected_directory" : null,
    },
  });
}

export async function adoptLocalResources(
  sourcePath?: string,
): Promise<ResourceAdoptionResult> {
  return invoke<ResourceAdoptionResult>("adopt_local_resources", {
    input: {
      sourcePath: sourcePath ?? null,
      sourceKind: sourcePath ? "selected_directory" : null,
      confirmed: true,
    },
  });
}

export async function planLocalResourceMove(
  parentPath: string,
): Promise<LocalResourceMovePlan> {
  return invoke<LocalResourceMovePlan>("plan_local_resource_move", {
    input: { parentPath },
  });
}

export async function moveLocalResourceRoot(
  parentPath: string,
  requestId: string,
): Promise<LocalResourceMoveResult> {
  return invoke<LocalResourceMoveResult>("move_local_resource_root", {
    input: { parentPath, confirmed: true },
    requestId,
  });
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

export async function setRuntimeStorageRoot(path: string): Promise<RuntimeCatalog> {
  return invoke<RuntimeCatalog>("set_runtime_storage_root", {
    input: { path },
  });
}

export async function setPreferredModel(
  modelKind: "small" | "base",
): Promise<RuntimeCatalog> {
  return invoke<RuntimeCatalog>("set_preferred_model", {
    input: { modelKind },
  });
}

export async function downloadRuntimeComponent(
  componentId: string,
): Promise<RuntimeCatalog> {
  return invoke<RuntimeCatalog>("download_runtime_component", {
    input: { componentId },
  });
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

export async function prepareProjectMedia(
  projectId: string,
  forceProxy: boolean,
  requestId?: string,
): Promise<MediaPreparation> {
  return invoke<MediaPreparation>("prepare_project_media", {
    input: { projectId, forceProxy },
    requestId,
  });
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

export async function deleteProject(
  projectId: string,
): Promise<DeleteProjectResult> {
  return invoke<DeleteProjectResult>("delete_project", { projectId });
}

export async function getTranscriptionRuntimeStatus(): Promise<TranscriptionRuntimeStatus> {
  if (!isDesktopApp) {
    return {
      available: false,
      preferredBackend: null,
      runtimes: [],
      models: [],
    };
  }
  return invoke<TranscriptionRuntimeStatus>("get_transcription_runtime_status");
}

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






export async function getCodexRuntimeStatus(): Promise<CodexRuntimeStatus> {
  return invoke<CodexRuntimeStatus>("get_codex_runtime_status");
}




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

export async function reconcileExternalAgentResults(): Promise<
  ExternalAgentResultUpdate[]
> {
  if (!isDesktopApp) {
    return [];
  }
  return invoke<ExternalAgentResultUpdate[]>(
    "reconcile_external_agent_results",
  );
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
