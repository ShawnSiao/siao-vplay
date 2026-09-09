export { commandError } from "./commandError";
export { prepareExplanationTask, getExplanationTask, listExplanationTasks, readExplanationPrompt, openExplanationMaterials, getExplanation, listExplanations, importExplanationResult, startCodexExplanationTask, cancelExplanationTask, resumeCodexExplanationTask } from "./explanationGateway";
export { prepareLearningTask, getLearningTask, listLearningTasks, readLearningPrompt, importLearningResult, startCodexLearningTask, cancelLearningTask, resumeCodexLearningTask } from "./learningGateway";
export { getDictionaryEntry, listDictionaryEntries } from "./dictionaryGateway";
export { prepareTranslationTask, getTranslationTask, listTranslationTasks, readTranslationPrompt, importTranslationResult, startCodexTranslationTask, cancelTranslationTask, resumeCodexTranslationTask } from "./translationGateway";
export { inspectSubtitleFile, importSubtitleFile, listSubtitleVersions, getSubtitleVersion, listSubtitleVersionMetadata, reviseSubtitleVersion, restoreSubtitleVersion, inspectEmbeddedSubtitle, importEmbeddedSubtitle } from "./subtitleGateway";
export { inspectYouTubeUrl, importYouTubeUrl, cancelYouTubeImport, getPublicResolverDisclosure } from "./publicVideoGateway";
export { getMediaPreparation, cancelMediaPreparation } from "./mediaPreparationGateway";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import { supportedVideoExtensions } from "./mediaFiles";
import { browserStatus } from "./appMetadata";
import { chooseConfiguredStorageDirectory } from "./storageDirectoryPicker";

import type {
  AppStatus,
  CapabilityPreparation,
  DeleteProjectResult,
  ExternalAgentResultUpdate,
  ExternalAgentTaskKind,
  LearningCard,
  LearningCardsExport,
  LocalResourceCatalog,
  LocalResourceLocationPlan,
  LocalResourceMovePlan,
  LocalResourceMoveResult,
  LocalResourceDiagnostics,
  LocalResourceStatus,
  MediaPreparation,
  MediaRuntimeStatus,
  Project,
  RemoteMediaPreview,
  RuntimeCatalog,
  ResourceDownloadTask,
  ResourceNetworkStatus,
  ResourceAdoptionResult,
  ResourceMigrationPreview,
  ResourceRemovalResult,
  ResourceRollbackResult,
  OldResourceVersionCleanupPlan,
  OldResourceVersionCleanupResult,
  UnusedResourceCleanupPlan,
  UnusedResourceCleanupResult,
  SubtitleBurnJob,
  SubtitleBurnMode,
  SubtitleBurnStyle,
  SubtitleExport,
  SubtitleExportFormat,
  SubtitleExportMode,
  TranscriptionRuntimeStatus,
  CodexRuntimeStatus,
} from "../types";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;

const browserResourceCapabilities = [
  {
    id: "basic_media",
    title: "基础视频支持",
    resourceIds: ["ffmpeg-cpu"],
    profileIds: [],
    requiresCapabilityIds: [],
  },
  {
    id: "url_import",
    title: "在线视频导入",
    resourceIds: ["ffmpeg-cpu", "yt-dlp"],
    profileIds: [],
    requiresCapabilityIds: [],
  },
  {
    id: "local_transcription",
    title: "本地字幕识别",
    resourceIds: ["ffmpeg-cpu", "whisper-cpu"],
    profileIds: ["fast", "standard"],
    requiresCapabilityIds: [],
  },
];

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

export async function getLocalResourceCatalog(): Promise<LocalResourceCatalog> {
  if (!isDesktopApp) {
    return {
      schemaVersion: 1,
      productId: "siaovplay",
      updatedAt: "",
      packageProfile: "app-only",
      bundlePolicy: {
        maximumExceptionBytes: 20_000_000,
        allowlistedResourceIds: [],
      },
      capabilities: browserResourceCapabilities,
      profiles: [
        {
          id: "fast",
          title: "快速",
          resourceIds: ["whisper-model-base"],
          recommended: false,
        },
        {
          id: "standard",
          title: "标准",
          resourceIds: ["whisper-model-small"],
          recommended: true,
        },
      ],
      resources: [
        {
          id: "ffmpeg-cpu",
          version: "8.1.2-34-g9b6c8969e0",
          platform: "windows-x86_64",
          kind: "archive",
          bundled: false,
          installedSize: 175_929_962,
          license: "LGPL-2.1-or-later",
          sourcePage: "https://github.com/BtbN/FFmpeg-Builds",
          artifact: {
            url: "https://example.invalid/ffmpeg.zip",
            size: 70_508_781,
            sha256: "0".repeat(64),
            format: "zip",
          },
          entrypoints: {},
          healthCheck: "ffmpeg-version",
        },
        {
          id: "yt-dlp",
          version: "2026.08.19",
          platform: "windows-x86_64",
          kind: "file",
          bundled: false,
          installedSize: 17_840_399,
          license: "GPL-3.0-or-later",
          sourcePage: "https://github.com/yt-dlp/yt-dlp",
          artifact: {
            url: "https://example.invalid/yt-dlp.exe",
            size: 17_840_399,
            sha256: "0".repeat(64),
            format: "file",
          },
          entrypoints: {},
          healthCheck: "yt-dlp-version",
        },
        {
          id: "whisper-cpu",
          version: "1.9.1",
          platform: "windows-x86_64",
          kind: "archive",
          bundled: false,
          installedSize: 20_355_072,
          license: "MIT",
          sourcePage: "https://github.com/ggml-org/whisper.cpp",
          artifact: {
            url: "https://example.invalid/whisper-bin-x64.zip",
            size: 7_982_101,
            sha256: "0".repeat(64),
            format: "zip",
            stripComponents: 1,
          },
          entrypoints: { whisperCli: "whisper-cli.exe" },
          healthCheck: "whisper-cli-version",
        },
        {
          id: "whisper-model-base",
          version: "whisper.cpp-base",
          platform: "all",
          kind: "model",
          bundled: false,
          installedSize: 147_951_465,
          license: "MIT",
          sourcePage: "https://huggingface.co/ggerganov/whisper.cpp",
          artifact: {
            url: "https://example.invalid/base.bin",
            size: 147_951_465,
            sha256: "0".repeat(64),
            format: "file",
          },
          entrypoints: {},
          healthCheck: "sha256",
        },
        {
          id: "whisper-model-small",
          version: "whisper.cpp-small",
          platform: "all",
          kind: "model",
          bundled: false,
          installedSize: 487_601_967,
          license: "MIT",
          sourcePage: "https://huggingface.co/ggerganov/whisper.cpp",
          artifact: {
            url: "https://example.invalid/small.bin",
            size: 487_601_967,
            sha256: "0".repeat(64),
            format: "file",
          },
          entrypoints: {},
          healthCheck: "sha256",
        },
      ],
    };
  }
  return invoke<LocalResourceCatalog>("get_local_resource_catalog");
}

export async function getLocalResourceStatus(): Promise<LocalResourceStatus> {
  if (!isDesktopApp) {
    return {
      configured: false,
      selectedParent: null,
      resourceRoot: null,
      rootState: "setup_required",
      freeSpaceBytes: null,
      preferredProfile: "standard",
      capabilities: browserResourceCapabilities.map((capability) => ({
        id: capability.id,
        title: capability.title,
        state: "setup_required" as const,
        requiredResourceIds: capability.resourceIds,
        missingResourceIds: capability.resourceIds,
      })),
    };
  }
  return invoke<LocalResourceStatus>("get_local_resource_status");
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

export async function configureLocalResourceRoot(
  parentPath: string,
  confirmed: boolean,
): Promise<LocalResourceStatus> {
  return invoke<LocalResourceStatus>("configure_local_resource_root", {
    input: { parentPath, confirmed },
  });
}

export async function repairLocalResourceRoot(): Promise<LocalResourceStatus> {
  return invoke<LocalResourceStatus>("repair_local_resource_root", {
    input: { confirmed: true },
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

export async function reconnectLocalResourceRoot(
  parentPath: string,
): Promise<LocalResourceStatus> {
  return invoke<LocalResourceStatus>("reconnect_local_resource_root", {
    input: { parentPath, confirmed: true },
  });
}

export async function planUnusedResourceCleanup(): Promise<UnusedResourceCleanupPlan> {
  return invoke<UnusedResourceCleanupPlan>("plan_unused_resource_cleanup");
}

export async function cleanupUnusedResources(): Promise<UnusedResourceCleanupResult> {
  return invoke<UnusedResourceCleanupResult>("cleanup_unused_resources", {
    input: { confirmed: true },
  });
}

export async function setLocalResourceProfile(
  profileId: string,
): Promise<LocalResourceStatus> {
  if (!isDesktopApp) {
    const status = await getLocalResourceStatus();
    return { ...status, preferredProfile: profileId };
  }
  return invoke<LocalResourceStatus>("set_local_resource_profile", {
    input: { profileId },
  });
}

export async function listResourceDownloadTasks(): Promise<
  ResourceDownloadTask[]
> {
  if (!isDesktopApp) {
    return [];
  }
  return invoke<ResourceDownloadTask[]>("list_resource_download_tasks");
}

export async function getLocalResourceNetworkStatus(): Promise<ResourceNetworkStatus> {
  if (!isDesktopApp) {
    return { mode: "direct", proxySource: "direct", proxyAddress: null };
  }
  return invoke<ResourceNetworkStatus>("get_local_resource_network_status");
}

export async function setLocalResourceProxy(
  proxyUrl: string | null,
): Promise<ResourceNetworkStatus> {
  return invoke<ResourceNetworkStatus>("set_local_resource_proxy", {
    input: { proxyUrl },
  });
}

export async function listenResourceDownloadTasks(
  listener: (task: ResourceDownloadTask) => void,
): Promise<UnlistenFn> {
  if (!isDesktopApp) {
    return () => undefined;
  }
  return listen<ResourceDownloadTask>(
    "local-resource-task-updated",
    (event) => listener(event.payload),
  );
}

export async function prepareLocalCapability(
  capabilityId: string,
  pendingActionId?: string,
): Promise<CapabilityPreparation> {
  return invoke<CapabilityPreparation>("prepare_local_capability", {
    input: { capabilityId, pendingActionId: pendingActionId ?? null },
  });
}

export async function pauseResourceDownload(
  taskId: string,
): Promise<ResourceDownloadTask> {
  return invoke<ResourceDownloadTask>("pause_resource_download", {
    input: { taskId },
  });
}

export async function resumeResourceDownload(
  taskId: string,
): Promise<ResourceDownloadTask> {
  return invoke<ResourceDownloadTask>("resume_resource_download", {
    input: { taskId },
  });
}

export async function cancelResourceDownload(
  taskId: string,
): Promise<ResourceDownloadTask> {
  return invoke<ResourceDownloadTask>("cancel_resource_download", {
    input: { taskId },
  });
}

export async function retryResourceDownload(
  taskId: string,
): Promise<ResourceDownloadTask> {
  return invoke<ResourceDownloadTask>("retry_resource_download", {
    input: { taskId },
  });
}

export async function repairLocalResource(
  resourceId: string,
): Promise<ResourceDownloadTask> {
  return invoke<ResourceDownloadTask>("repair_local_resource", {
    input: { resourceId },
  });
}

export async function updateLocalResource(
  resourceId: string,
): Promise<ResourceDownloadTask> {
  return invoke<ResourceDownloadTask>("update_local_resource", {
    input: { resourceId },
  });
}

export async function removeLocalResource(
  resourceId: string,
  confirmed: boolean,
): Promise<ResourceRemovalResult> {
  return invoke<ResourceRemovalResult>("remove_local_resource", {
    input: { resourceId, confirmed },
  });
}

export async function getLocalResourceDiagnostics(): Promise<LocalResourceDiagnostics> {
  return invoke<LocalResourceDiagnostics>("get_local_resource_diagnostics");
}

export async function getLocalResourceDiagnosticSummary(): Promise<string> {
  return invoke<string>("get_local_resource_diagnostic_summary");
}

export async function getLocalResourceThirdPartyNotices(): Promise<string> {
  return invoke<string>("get_local_resource_third_party_notices");
}

export async function rollbackLocalResource(
  resourceId: string,
  version: string,
): Promise<ResourceRollbackResult> {
  return invoke<ResourceRollbackResult>("rollback_local_resource", {
    input: { resourceId, version, confirmed: true },
  });
}

export async function planOldResourceVersionCleanup(): Promise<OldResourceVersionCleanupPlan> {
  return invoke<OldResourceVersionCleanupPlan>("plan_old_resource_version_cleanup");
}

export async function cleanupOldResourceVersions(): Promise<OldResourceVersionCleanupResult> {
  return invoke<OldResourceVersionCleanupResult>("cleanup_old_resource_versions", {
    input: { confirmed: true },
  });
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

export async function startSubtitleBurn(
  projectId: string,
  mode: SubtitleBurnMode,
  sourceVersionId: string | null,
  translationVersionId: string,
  destinationDirectory: string,
  style: SubtitleBurnStyle,
): Promise<SubtitleBurnJob> {
  return invoke<SubtitleBurnJob>("start_subtitle_burn", {
    input: {
      projectId,
      mode,
      sourceVersionId,
      translationVersionId,
      destinationDirectory,
      style,
      confirmVersionSelection: true,
    },
  });
}

export async function getSubtitleBurnJob(
  jobId: string,
): Promise<SubtitleBurnJob> {
  return invoke<SubtitleBurnJob>("get_subtitle_burn_job", {
    input: { jobId },
  });
}

export async function listSubtitleBurnJobs(
  projectId: string,
): Promise<SubtitleBurnJob[]> {
  return invoke<SubtitleBurnJob[]>("list_subtitle_burn_jobs", { projectId });
}

export async function cancelSubtitleBurnJob(
  jobId: string,
): Promise<SubtitleBurnJob> {
  return invoke<SubtitleBurnJob>("cancel_subtitle_burn_job", {
    input: { jobId },
  });
}

export async function resumeSubtitleBurnJob(
  jobId: string,
): Promise<SubtitleBurnJob> {
  return invoke<SubtitleBurnJob>("resume_subtitle_burn_job", {
    input: { jobId },
  });
}

export function playbackUrl(path: string): string {
  return isDesktopApp ? convertFileSrc(path) : "";
}
