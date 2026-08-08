import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import { supportedVideoExtensions } from "./mediaFiles";

import type {
  AppStatus,
  CapabilityPreparation,
  DeleteProjectResult,
  DesktopCommandError,
  EmbeddedSubtitlePreview,
  ExternalAgentResultUpdate,
  ExternalAgentTaskKind,
  Explanation,
  ExplanationApplication,
  ExplanationTask,
  DictionaryEntry,
  LearningApplication,
  LearningCard,
  LearningCardsExport,
  LearningSelectionKind,
  LearningTask,
  LocalResourceCatalog,
  LocalResourceLocationPlan,
  LocalResourceStatus,
  MediaPreparation,
  MediaRuntimeStatus,
  Project,
  RemoteMediaPreview,
  RuntimeCatalog,
  ResourceDownloadTask,
  ResourceRemovalResult,
  SubtitleGlobalReplacement,
  SubtitleBurnJob,
  SubtitleBurnMode,
  SubtitleExport,
  SubtitleExportFormat,
  SubtitleExportMode,
  SubtitleImportPreview,
  SubtitleSegmentEdit,
  SubtitleVersion,
  TranscriptionJob,
  TranscriptionRuntimeStatus,
  CodexRuntimeStatus,
  TranslationApplication,
  TranslationTask,
  YouTubeMediaPreview,
} from "../types";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;

const browserStatus: AppStatus = {
  appName: "SiaoVPlay",
  version: "0.3.0",
  platform: "browser-preview",
  dataDirectory: "仅桌面应用可用",
  startupMediaPath: null,
};

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
    profileIds: ["standard"],
    requiresCapabilityIds: [],
  },
  {
    id: "accelerated_transcription",
    title: "高性能字幕识别",
    resourceIds: ["whisper-vulkan"],
    profileIds: [],
    requiresCapabilityIds: ["local_transcription"],
  },
];

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
          id: "standard",
          title: "标准",
          resourceIds: ["whisper-model-small"],
          recommended: true,
        },
      ],
      resources: [
        {
          id: "ffmpeg-cpu",
          version: "8.1",
          platform: "windows-x86_64",
          kind: "archive",
          bundled: false,
          installedSize: 175_926_890,
          license: "LGPL-2.1-or-later",
          sourcePage: "https://github.com/BtbN/FFmpeg-Builds",
          artifact: {
            url: "https://example.invalid/ffmpeg.zip",
            size: 70_510_962,
            sha256: "0".repeat(64),
            format: "zip",
          },
          entrypoints: {},
          healthCheck: "ffmpeg-version",
        },
        {
          id: "yt-dlp",
          version: "2026.06.09",
          platform: "windows-x86_64",
          kind: "file",
          bundled: false,
          installedSize: 18_202_192,
          license: "GPL-3.0-or-later",
          sourcePage: "https://github.com/yt-dlp/yt-dlp",
          artifact: {
            url: "https://example.invalid/yt-dlp.exe",
            size: 18_202_192,
            sha256: "0".repeat(64),
            format: "file",
          },
          entrypoints: {},
          healthCheck: "yt-dlp-version",
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

export async function listResourceDownloadTasks(): Promise<
  ResourceDownloadTask[]
> {
  if (!isDesktopApp) {
    return [];
  }
  return invoke<ResourceDownloadTask[]>("list_resource_download_tasks");
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

export async function removeLocalResource(
  resourceId: string,
  confirmed: boolean,
): Promise<ResourceRemovalResult> {
  return invoke<ResourceRemovalResult>("remove_local_resource", {
    input: { resourceId, confirmed },
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

export async function inspectYouTubeUrl(
  url: string,
): Promise<YouTubeMediaPreview> {
  return invoke<YouTubeMediaPreview>("inspect_youtube_url", {
    input: { url },
  });
}

export async function importYouTubeUrl(
  url: string,
  expectedPreviewToken: string,
  operationId: string,
): Promise<Project> {
  return invoke<Project>("import_youtube_url", {
    input: {
      url,
      expectedPreviewToken,
      operationId,
    },
  });
}

export async function cancelYouTubeImport(
  operationId: string,
): Promise<boolean> {
  return invoke<boolean>("cancel_youtube_import", {
    input: { operationId },
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
    "sourceSha256" | "expectedMediaSha256" | "expectedProjectRevision"
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

export async function reviseSubtitleVersion(
  projectId: string,
  baseVersionId: string,
  expectedProjectRevision: number,
  segmentEdits: SubtitleSegmentEdit[] = [],
  globalReplacement: SubtitleGlobalReplacement | null = null,
  offsetMs = 0,
): Promise<SubtitleVersion> {
  return invoke<SubtitleVersion>("revise_subtitle_version", {
    input: {
      projectId,
      baseVersionId,
      expectedProjectRevision,
      segmentEdits,
      globalReplacement,
      offsetMs,
    },
  });
}

export async function restoreSubtitleVersion(
  projectId: string,
  currentVersionId: string,
  restoreVersionId: string,
  expectedProjectRevision: number,
): Promise<SubtitleVersion> {
  return invoke<SubtitleVersion>("restore_subtitle_version", {
    input: {
      projectId,
      currentVersionId,
      restoreVersionId,
      expectedProjectRevision,
    },
  });
}

export async function inspectEmbeddedSubtitle(
  projectId: string,
  streamIndex: number,
  languageCode: string,
): Promise<EmbeddedSubtitlePreview> {
  return invoke<EmbeddedSubtitlePreview>("inspect_embedded_subtitle", {
    input: { projectId, streamIndex, languageCode },
  });
}

export async function importEmbeddedSubtitle(
  projectId: string,
  streamIndex: number,
  languageCode: string,
  preview: Pick<
    EmbeddedSubtitlePreview,
    "sourceSha256" | "expectedMediaSha256" | "expectedProjectRevision"
  >,
): Promise<SubtitleVersion> {
  return invoke<SubtitleVersion>("import_embedded_subtitle", {
    input: {
      projectId,
      streamIndex,
      languageCode,
      expectedSourceSha256: preview.sourceSha256,
      expectedMediaSha256: preview.expectedMediaSha256,
      expectedProjectRevision: preview.expectedProjectRevision,
    },
  });
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

export async function startTranscription(
  projectId: string,
  languageCode: "auto" | "en" | "th" | "ja" | "ko",
  modelKind: "small" | "base" = "small",
  confirmReplaceOriginal = false,
): Promise<TranscriptionJob> {
  return invoke<TranscriptionJob>("start_transcription", {
    input: {
      projectId,
      languageCode,
      modelKind,
      confirmReplaceOriginal,
    },
  });
}

export async function getTranscriptionJob(
  jobId: string,
): Promise<TranscriptionJob> {
  return invoke<TranscriptionJob>("get_transcription_job", {
    input: { jobId },
  });
}

export async function listTranscriptionJobs(
  projectId: string,
): Promise<TranscriptionJob[]> {
  return invoke<TranscriptionJob[]>("list_transcription_jobs", { projectId });
}

export async function cancelTranscriptionJob(
  jobId: string,
): Promise<TranscriptionJob> {
  return invoke<TranscriptionJob>("cancel_transcription_job", {
    input: { jobId },
  });
}

export async function resumeTranscriptionJob(
  jobId: string,
): Promise<TranscriptionJob> {
  return invoke<TranscriptionJob>("resume_transcription_job", {
    input: { jobId },
  });
}

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

export async function prepareTranslationTask(
  projectId: string,
  handoffKind: "manual" | "codex",
  segmentIds?: string[],
): Promise<TranslationTask> {
  return invoke<TranslationTask>("prepare_translation_task", {
    input: { projectId, handoffKind, segmentIds },
  });
}

export async function getTranslationTask(
  taskId: string,
): Promise<TranslationTask> {
  return invoke<TranslationTask>("get_translation_task", {
    input: { taskId },
  });
}

export async function listTranslationTasks(
  projectId: string,
): Promise<TranslationTask[]> {
  return invoke<TranslationTask[]>("list_translation_tasks", { projectId });
}

export async function readTranslationPrompt(taskId: string): Promise<string> {
  return invoke<string>("read_translation_prompt", {
    input: { taskId },
  });
}

export async function importTranslationResult(
  taskId: string,
  resultPath: string,
): Promise<TranslationApplication> {
  return invoke<TranslationApplication>("import_translation_result", {
    input: { taskId, resultPath },
  });
}

export async function getCodexRuntimeStatus(): Promise<CodexRuntimeStatus> {
  return invoke<CodexRuntimeStatus>("get_codex_runtime_status");
}

export async function startCodexTranslationTask(
  taskId: string,
  timeoutSeconds?: number,
): Promise<TranslationTask> {
  return invoke<TranslationTask>("start_codex_translation_task", {
    input: { taskId, timeoutSeconds },
  });
}

export async function cancelTranslationTask(
  taskId: string,
): Promise<TranslationTask> {
  return invoke<TranslationTask>("cancel_translation_task", {
    input: { taskId },
  });
}

export async function resumeCodexTranslationTask(
  taskId: string,
  timeoutSeconds?: number,
): Promise<TranslationTask> {
  return invoke<TranslationTask>("resume_codex_translation_task", {
    input: { taskId, timeoutSeconds },
  });
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

export async function prepareExplanationTask(
  projectId: string,
  handoffKind: "manual" | "codex",
  playbackCutoffMs: number,
): Promise<ExplanationTask> {
  return invoke<ExplanationTask>("prepare_explanation_task", {
    input: { projectId, handoffKind, playbackCutoffMs },
  });
}

export async function getExplanationTask(
  taskId: string,
): Promise<ExplanationTask> {
  return invoke<ExplanationTask>("get_explanation_task", { taskId });
}

export async function listExplanationTasks(
  projectId: string,
): Promise<ExplanationTask[]> {
  return invoke<ExplanationTask[]>("list_explanation_tasks", { projectId });
}

export async function readExplanationPrompt(taskId: string): Promise<string> {
  return invoke<string>("read_explanation_prompt", { taskId });
}

export async function openExplanationMaterials(
  taskId: string,
): Promise<boolean> {
  return invoke<boolean>("open_explanation_materials", { taskId });
}

export async function getExplanation(
  explanationId: string,
): Promise<Explanation> {
  return invoke<Explanation>("get_explanation", { explanationId });
}

export async function listExplanations(
  projectId: string,
): Promise<Explanation[]> {
  return invoke<Explanation[]>("list_explanations", { projectId });
}

export async function importExplanationResult(
  taskId: string,
  resultPath: string,
): Promise<ExplanationApplication> {
  return invoke<ExplanationApplication>("import_explanation_result", {
    input: { taskId, resultPath },
  });
}

export async function startCodexExplanationTask(
  taskId: string,
  timeoutSeconds?: number,
): Promise<ExplanationTask> {
  return invoke<ExplanationTask>("start_codex_explanation_task", {
    input: { taskId, timeoutSeconds },
  });
}

export async function cancelExplanationTask(
  taskId: string,
): Promise<ExplanationTask> {
  return invoke<ExplanationTask>("cancel_explanation_task", { taskId });
}

export async function resumeCodexExplanationTask(
  taskId: string,
  timeoutSeconds?: number,
): Promise<ExplanationTask> {
  return invoke<ExplanationTask>("resume_codex_explanation_task", {
    input: { taskId, timeoutSeconds },
  });
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

export async function prepareLearningTask(
  projectId: string,
  handoffKind: "manual" | "codex",
  sourceSegmentId: string,
  selectedText: string,
  selectionKind: LearningSelectionKind,
  playbackPositionMs: number,
): Promise<LearningTask> {
  return invoke<LearningTask>("prepare_learning_task", {
    input: {
      projectId,
      handoffKind,
      sourceSegmentId,
      selectedText,
      selectionKind,
      playbackPositionMs,
    },
  });
}

export async function getLearningTask(taskId: string): Promise<LearningTask> {
  return invoke<LearningTask>("get_learning_task", { taskId });
}

export async function listLearningTasks(
  projectId: string,
): Promise<LearningTask[]> {
  return invoke<LearningTask[]>("list_learning_tasks", { projectId });
}

export async function readLearningPrompt(taskId: string): Promise<string> {
  return invoke<string>("read_learning_prompt", { taskId });
}

export async function getDictionaryEntry(
  entryId: string,
): Promise<DictionaryEntry> {
  return invoke<DictionaryEntry>("get_dictionary_entry", { entryId });
}

export async function listDictionaryEntries(
  projectId: string,
): Promise<DictionaryEntry[]> {
  return invoke<DictionaryEntry[]>("list_dictionary_entries", { projectId });
}

export async function importLearningResult(
  taskId: string,
  resultPath: string,
): Promise<LearningApplication> {
  return invoke<LearningApplication>("import_learning_result", {
    input: { taskId, resultPath },
  });
}

export async function startCodexLearningTask(
  taskId: string,
  timeoutSeconds?: number,
): Promise<LearningTask> {
  return invoke<LearningTask>("start_codex_learning_task", {
    input: { taskId, timeoutSeconds },
  });
}

export async function cancelLearningTask(
  taskId: string,
): Promise<LearningTask> {
  return invoke<LearningTask>("cancel_learning_task", { taskId });
}

export async function resumeCodexLearningTask(
  taskId: string,
  timeoutSeconds?: number,
): Promise<LearningTask> {
  return invoke<LearningTask>("resume_codex_learning_task", {
    input: { taskId, timeoutSeconds },
  });
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

export async function chooseSubtitleDeliveryDirectory(): Promise<
  string | null
> {
  if (!isDesktopApp) {
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: true,
    title: "选择字幕或烧录视频保存位置",
  });
  return typeof selected === "string" ? selected : null;
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
): Promise<SubtitleBurnJob> {
  return invoke<SubtitleBurnJob>("start_subtitle_burn", {
    input: {
      projectId,
      mode,
      sourceVersionId,
      translationVersionId,
      destinationDirectory,
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
