import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DictionaryEntry,
  EmbeddedSubtitlePreview,
  Explanation,
  ExplanationTask,
  LearningCard,
  LearningTask,
  MediaPreparation,
  Project,
  RemoteMediaPreview,
  SubtitleBurnJob,
  SubtitleExport,
  SubtitleImportPreview,
  SubtitleVersion,
  TranscriptionJob,
  TranslationTask,
  YouTubeMediaPreview,
} from "./types";

const desktopMocks = vi.hoisted(() => ({
  getAppStatus: vi.fn(),
  getMediaRuntimeStatus: vi.fn(),
  setMainWindowMediaTitle: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  chooseLocalVideo: vi.fn(),
  chooseSubtitleFile: vi.fn(),
  createLocalProject: vi.fn(),
  inspectRemoteMediaUrl: vi.fn(),
  importRemoteMediaUrl: vi.fn(),
  cancelRemoteMediaImport: vi.fn(),
  inspectYouTubeUrl: vi.fn(),
  importYouTubeUrl: vi.fn(),
  cancelYouTubeImport: vi.fn(),
  ensureProjectPoster: vi.fn(),
  markProjectOpened: vi.fn(),
  prepareProjectMedia: vi.fn(),
  updatePlaybackState: vi.fn(),
  relinkProjectMedia: vi.fn(),
  deleteProject: vi.fn(),
  inspectSubtitleFile: vi.fn(),
  importSubtitleFile: vi.fn(),
  inspectEmbeddedSubtitle: vi.fn(),
  importEmbeddedSubtitle: vi.fn(),
  listSubtitleVersions: vi.fn(),
  reviseSubtitleVersion: vi.fn(),
  restoreSubtitleVersion: vi.fn(),
  getTranscriptionRuntimeStatus: vi.fn(),
  startTranscription: vi.fn(),
  getTranscriptionJob: vi.fn(),
  listTranscriptionJobs: vi.fn(),
  cancelTranscriptionJob: vi.fn(),
  resumeTranscriptionJob: vi.fn(),
  getCodexRuntimeStatus: vi.fn(),
  prepareTranslationTask: vi.fn(),
  getTranslationTask: vi.fn(),
  listTranslationTasks: vi.fn(),
  readTranslationPrompt: vi.fn(),
  chooseTranslationResultFile: vi.fn(),
  importTranslationResult: vi.fn(),
  startCodexTranslationTask: vi.fn(),
  cancelTranslationTask: vi.fn(),
  resumeCodexTranslationTask: vi.fn(),
  chooseExplanationResultFile: vi.fn(),
  prepareExplanationTask: vi.fn(),
  getExplanationTask: vi.fn(),
  listExplanationTasks: vi.fn(),
  readExplanationPrompt: vi.fn(),
  openExplanationMaterials: vi.fn(),
  getExplanation: vi.fn(),
  listExplanations: vi.fn(),
  importExplanationResult: vi.fn(),
  startCodexExplanationTask: vi.fn(),
  cancelExplanationTask: vi.fn(),
  resumeCodexExplanationTask: vi.fn(),
  chooseLearningResultFile: vi.fn(),
  chooseLearningExportDirectory: vi.fn(),
  prepareLearningTask: vi.fn(),
  getLearningTask: vi.fn(),
  listLearningTasks: vi.fn(),
  readLearningPrompt: vi.fn(),
  getDictionaryEntry: vi.fn(),
  listDictionaryEntries: vi.fn(),
  importLearningResult: vi.fn(),
  startCodexLearningTask: vi.fn(),
  cancelLearningTask: vi.fn(),
  resumeCodexLearningTask: vi.fn(),
  reconcileExternalAgentResults: vi.fn(),
  openExternalResultDirectory: vi.fn(),
  createLearningCard: vi.fn(),
  getLearningCard: vi.fn(),
  listLearningCards: vi.fn(),
  deleteLearningCard: vi.fn(),
  exportLearningCards: vi.fn(),
  chooseSubtitleDeliveryDirectory: vi.fn(),
  exportSubtitles: vi.fn(),
  startSubtitleBurn: vi.fn(),
  getSubtitleBurnJob: vi.fn(),
  listSubtitleBurnJobs: vi.fn(),
  cancelSubtitleBurnJob: vi.fn(),
  resumeSubtitleBurnJob: vi.fn(),
}));

vi.mock("./lib/desktop", () => ({
  ...desktopMocks,
  isDesktopApp: true,
  commandError: (error: unknown) => ({
    code: "test_error",
    message: error instanceof Error ? error.message : String(error),
  }),
  playbackUrl: (path: string) => `asset://localhost/${path}`,
}));

import App from "./App";

const project: Project = {
  id: "6f946e1b-3ddb-42a8-8324-28b7eae443c7",
  title: "雨站台",
  status: "ready",
  revision: 1,
  createdAtMs: 1_785_354_000_000,
  updatedAtMs: 1_785_354_000_000,
  lastOpenedAtMs: 1_785_354_000_000,
  mediaSource: {
    id: "5f5ef2ef-53a4-4ae3-8bc6-c366c3286396",
    kind: "local_file",
    locator: "W:\\media\\rain-platform.mp4",
    originUrl: null,
    displayName: "rain-platform.mp4",
    isAvailable: true,
    sourceSha256: null,
    probedAtMs: null,
    posterPath: null,
    createdAtMs: 1_785_354_000_000,
    updatedAtMs: 1_785_354_000_000,
  },
  playbackState: {
    positionMs: 42_000,
    durationMs: 180_000,
    volume: 0.8,
    playbackRate: 1,
    subtitleMode: "translation",
    updatedAtMs: 1_785_354_000_000,
  },
};

const preparation: MediaPreparation = {
  inspection: {
    projectId: project.id,
    mediaSourceId: project.mediaSource.id,
    sourceSha256: "a".repeat(64),
    probe: {
      containerFormats: ["mov", "mp4"],
      durationMs: 180_000,
      sizeBytes: 12_500_000,
      bitRate: 2_000_000,
      videoStreams: [
        {
          index: 0,
          codecName: "h264",
          profile: "High",
          pixelFormat: "yuv420p",
          width: 1920,
          height: 1080,
          frameRate: 30,
          durationMs: 180_000,
        },
      ],
      audioStreams: [
        {
          index: 1,
          codecName: "aac",
          channels: 2,
          sampleRateHz: 48_000,
          durationMs: 180_000,
        },
      ],
      subtitleStreams: [],
    },
    playbackGate: {
      decision: "direct",
      reasonCodes: ["h264_aac_candidate"],
      requiresRuntimeVideoCheck: true,
    },
    ffmpegVersion: "ffmpeg 8.1.1",
    reusedProbe: false,
  },
  playbackSourceKind: "original",
  playbackPath: project.mediaSource.locator,
  proxyArtifact: null,
  reusedProxy: false,
};

const remotePreview: RemoteMediaPreview = {
  originalUrl: "https://media.example.com/rain-platform.mp4",
  finalUrl: "https://cdn.example.com/rain-platform.mp4",
  displayName: "rain-platform.mp4",
  mediaKind: "direct_file",
  contentType: "video/mp4",
  contentLength: 12_500_000,
  previewToken: "c".repeat(64),
};

const remoteProject: Project = {
  ...project,
  id: "171f95a8-938c-4d0c-887b-e4c626f27c70",
  mediaSource: {
    ...project.mediaSource,
    id: "29645135-bcb4-4f56-b4c7-3ec1bf59cd28",
    locator: "W:\\SiaoVPlay\\app-data\\remote-media\\import-1\\source.mp4",
    originUrl: remotePreview.originalUrl,
  },
};

const youtubePreview: YouTubeMediaPreview = {
  originalUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  webpageUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  videoId: "jNQXAC9IVRw",
  title: "Me at the zoo",
  durationSeconds: 19,
  fileSizeBytes: 533_067,
  importerVersion: "2026.06.09",
  importerSha256: "3".repeat(64),
  previewToken: "d".repeat(64),
};

const subtitlePreview: SubtitleImportPreview = {
  format: "srt",
  sourceLabel: "rain-platform.ja.srt",
  sourceSha256: "b".repeat(64),
  languageCode: "ja",
  expectedProjectRevision: 1,
  expectedMediaSha256: "a".repeat(64),
  cues: [
    {
      ordinal: 0,
      startMs: 0,
      endMs: 1_500,
      text: "待っていたの？",
      confidence: null,
    },
  ],
  preflight: {
    status: "ready",
    segmentCount: 1,
    errorCount: 0,
    warningCount: 0,
    firstStartMs: 0,
    lastEndMs: 1_500,
    mediaDurationMs: 180_000,
    coverageRatio: 0.0083,
    issues: [],
  },
  canImport: true,
};

const embeddedSubtitlePreview: EmbeddedSubtitlePreview = {
  ...subtitlePreview,
  format: "vtt",
  sourceLabel: "内嵌字幕轨 2 · JPN · SUBRIP",
  streamIndex: 2,
  codecName: "subrip",
  embeddedLanguage: "jpn",
};

const subtitleVersion: SubtitleVersion = {
  id: "e83a710a-5fe3-46ec-a523-8296b71d75f1",
  trackId: "b502722c-a906-4810-a861-4d9af8e9f24c",
  projectId: project.id,
  role: "original",
  versionNumber: 1,
  status: "ready",
  sourceKind: "imported_file",
  sourceLabel: subtitlePreview.sourceLabel,
  sourceSha256: subtitlePreview.sourceSha256,
  mediaSha256: subtitlePreview.expectedMediaSha256,
  languageCode: "ja",
  projectRevision: 2,
  parentVersionId: null,
  sourceTaskId: null,
  preflight: subtitlePreview.preflight,
  createdAtMs: 1_785_354_100_000,
  isCurrent: true,
  segments: [
    {
      id: "5a460d9a-97f6-4482-af1d-e7dbb7a6bc56",
      lineageId: "5a460d9a-97f6-4482-af1d-e7dbb7a6bc56",
      sourceSegmentId: null,
      issueKind: null,
      ...subtitlePreview.cues[0],
      words: [],
    },
  ],
};

const transcriptionJob: TranscriptionJob = {
  id: "e7a8d3cf-cf3e-4ae3-b02c-40181410cd36",
  projectId: project.id,
  status: "extracting",
  stage: "extracting_audio",
  progress: 0.05,
  languageCode: "ja",
  modelKind: "small",
  runtimeBackend: "vulkan",
  runtimeVersion: "1.9.1-siaocut.1",
  subtitleVersionId: null,
  errorCode: null,
  errorMessage: null,
  createdAtMs: 1_785_354_200_000,
  updatedAtMs: 1_785_354_200_000,
  startedAtMs: 1_785_354_200_000,
  completedAtMs: null,
};

const translationTask: TranslationTask = {
  id: "f92041a1-5d07-4db0-b63d-565c12ceab36",
  projectId: project.id,
  taskType: "subtitle_translation",
  handoffKind: "codex",
  protocolVersion: "siaovplay-agent-v1",
  status: "queued",
  stage: "queued",
  progress: 0,
  receiverLabel: "本机 Codex",
  materialScope: [
    "原文字幕文本",
    "字幕时间码",
    "任务与字幕版本标识",
    "人物与术语上下文（当前为空）",
  ],
  sourceVersionId: subtitleVersion.id,
  sourceLanguageCode: "ja",
  targetLanguageCode: "zh-cn",
  authorizedSegmentIds: [subtitleVersion.segments[0].id],
  segmentCount: 1,
  expectedProjectRevision: 2,
  baseTranslationVersionId: null,
  outputVersionId: null,
  validation: null,
  errorCode: null,
  errorMessage: null,
  createdAtMs: 1_785_354_300_000,
  updatedAtMs: 1_785_354_300_000,
  startedAtMs: null,
  completedAtMs: null,
};

const translatedVersion: SubtitleVersion = {
  ...subtitleVersion,
  id: "ebcbfca4-9e65-43d8-9e36-65a1f71f7569",
  trackId: "22a9438b-32ae-4898-b79d-6e58e2f0562f",
  role: "translation",
  status: "draft",
  sourceKind: "agent_translation",
  sourceLabel: "Codex 翻译",
  sourceSha256: "c".repeat(64),
  languageCode: "zh-cn",
  projectRevision: 3,
  sourceTaskId: translationTask.id,
  segments: [
    {
      ...subtitleVersion.segments[0],
      id: "f88389a3-5a44-43e9-a474-696cad8f29ea",
      lineageId: "f88389a3-5a44-43e9-a474-696cad8f29ea",
      sourceSegmentId: subtitleVersion.segments[0].id,
      issueKind: null,
      text: "明天在车站前见吧。",
    },
  ],
};

const completedTranslationTask: TranslationTask = {
  ...translationTask,
  status: "completed",
  stage: "completed",
  progress: 1,
  outputVersionId: translatedVersion.id,
  validation: {
    status: "accepted",
    translationCount: 1,
    warningCount: 0,
    warnings: [],
  },
  startedAtMs: 1_785_354_301_000,
  completedAtMs: 1_785_354_310_000,
};

const explanationTask: ExplanationTask = {
  id: "3f4ed2ea-f522-4914-a846-c4187e39caa9",
  projectId: project.id,
  handoffKind: "codex",
  protocolVersion: "siaovplay-understanding-v1",
  status: "queued",
  stage: "queued",
  progress: 0,
  receiverLabel: "本机 Codex",
  materialScope: [
    "播放截止时间以内的原文字幕",
    "对应的简体中文字幕（如有）",
    "不晚于播放位置的最多三张关键帧",
  ],
  sourceVersionId: subtitleVersion.id,
  translationVersionId: translatedVersion.id,
  authorizedSegmentIds: [subtitleVersion.segments[0].id],
  playbackCutoffMs: 42_000,
  sceneStartMs: 0,
  expectedProjectRevision: 3,
  outputExplanationId: null,
  errorCode: null,
  errorMessage: null,
  createdAtMs: 1_785_354_320_000,
  updatedAtMs: 1_785_354_320_000,
  startedAtMs: null,
  completedAtMs: null,
  frames: [
    {
      id: "16e2210a-62e4-4df8-a0cc-25a9c218f998",
      ordinal: 0,
      timestampMs: 41_750,
      path: "W:\\SiaoVPlay\\agent-tasks\\task\\input\\frames\\frame-0001.jpg",
      sha256: "d".repeat(64),
    },
  ],
};

const explanation: Explanation = {
  id: "194b4275-8790-426a-91bb-ee31c01dc902",
  projectId: project.id,
  taskId: explanationTask.id,
  sourceVersionId: subtitleVersion.id,
  translationVersionId: translatedVersion.id,
  playbackCutoffMs: 42_000,
  sceneStartMs: 0,
  confirmedFacts: ["人物明确提到会在车站前见面。"],
  possibleInterpretations: ["结合当前语气，这个约定对人物可能很重要。"],
  withheldReason: "后续发展未展开，以避免剧透。",
  createdAtMs: 1_785_354_330_000,
};

const learningTask: LearningTask = {
  id: "d34346c4-ec23-4f05-aee5-29ec8c8942aa",
  projectId: project.id,
  handoffKind: "codex",
  protocolVersion: "siaovplay-learning-v1",
  status: "queued",
  stage: "queued",
  progress: 0,
  receiverLabel: "本机 Codex",
  materialScope: [
    "所选原文",
    "当前原文字幕",
    "对应的简体中文字幕（如有）",
    "字幕语言、版本标识和播放位置",
  ],
  sourceVersionId: subtitleVersion.id,
  translationVersionId: translatedVersion.id,
  sourceSegmentId: subtitleVersion.segments[0].id,
  selectedText: subtitleVersion.segments[0].text,
  selectionKind: "sentence",
  playbackPositionMs: 500,
  expectedProjectRevision: 3,
  outputDictionaryEntryId: null,
  errorCode: null,
  errorMessage: null,
  createdAtMs: 1_785_354_340_000,
  updatedAtMs: 1_785_354_340_000,
  startedAtMs: null,
  completedAtMs: null,
};

const dictionaryEntry: DictionaryEntry = {
  id: "4458e67e-3585-49ef-82c4-cfaec8ab93b2",
  projectId: project.id,
  taskId: learningTask.id,
  sourceVersionId: subtitleVersion.id,
  translationVersionId: translatedVersion.id,
  sourceSegmentId: subtitleVersion.segments[0].id,
  selectedText: subtitleVersion.segments[0].text,
  selectionKind: "sentence",
  pronunciation: "matte ita no",
  partOfSpeech: "疑问句",
  contextualMeaning: "结合当前台词，询问对方是否一直在等待。",
  usageNote: "句末的「の」让语气更柔和，也带有确认意味。",
  sourceSentence: subtitleVersion.segments[0].text,
  translatedSentence: translatedVersion.segments[0].text,
  languageCode: "ja",
  playbackPositionMs: 500,
  createdAtMs: 1_785_354_350_000,
};

const learningCard: LearningCard = {
  id: "74da93a8-8cbe-4573-b2aa-56bd834d58fd",
  projectId: project.id,
  dictionaryEntryId: dictionaryEntry.id,
  sourceVersionId: subtitleVersion.id,
  translationVersionId: translatedVersion.id,
  sourceSegmentId: subtitleVersion.segments[0].id,
  selectedText: dictionaryEntry.selectedText,
  selectionKind: dictionaryEntry.selectionKind,
  pronunciation: dictionaryEntry.pronunciation,
  partOfSpeech: dictionaryEntry.partOfSpeech,
  contextualMeaning: dictionaryEntry.contextualMeaning,
  usageNote: dictionaryEntry.usageNote,
  sourceSentence: dictionaryEntry.sourceSentence,
  translatedSentence: dictionaryEntry.translatedSentence,
  languageCode: dictionaryEntry.languageCode,
  playbackPositionMs: 900,
  screenshotPath:
    "W:\\SiaoVPlay\\app-data\\learning-cards\\project\\card\\scene.jpg",
  screenshotSha256: "e".repeat(64),
  screenshotAvailable: true,
  createdAtMs: 1_785_354_360_000,
  updatedAtMs: 1_785_354_360_000,
};

const subtitleExport: SubtitleExport = {
  filePath: "W:\\exports\\雨站台.bilingual.vtt",
  manifestPath: "W:\\exports\\雨站台.bilingual.vtt.siaovplay.json",
  fileSha256: "f".repeat(64),
  mode: "bilingual",
  format: "vtt",
  cueCount: 1,
  sourceVersionId: subtitleVersion.id,
  translationVersionId: translatedVersion.id,
  mediaSha256: "a".repeat(64),
  exportedAtMs: 1_785_354_370_000,
};

const burnJob: SubtitleBurnJob = {
  id: "8c6bb86e-fe50-41fa-a2a3-0bcd956dfdc6",
  projectId: project.id,
  status: "queued",
  stage: "queued",
  progress: 0,
  mode: "translation",
  sourceVersionId: null,
  translationVersionId: translatedVersion.id,
  outputPath: null,
  manifestPath: null,
  outputSha256: null,
  runtimeVersion: "ffmpeg 8.1.1",
  errorCode: null,
  errorMessage: null,
  createdAtMs: 1_785_354_380_000,
  updatedAtMs: 1_785_354_380_000,
  startedAtMs: null,
  completedAtMs: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  desktopMocks.getAppStatus.mockResolvedValue({
    appName: "SiaoVPlay",
    version: "0.1.0",
    platform: "windows-desktop",
    dataDirectory: "W:\\SiaoVPlay\\app-data",
    startupMediaPath: null,
  });
  desktopMocks.getMediaRuntimeStatus.mockResolvedValue({
    available: true,
    ffmpegPath: "W:\\SiaoVPlay\\runtimes\\ffmpeg\\bin\\ffmpeg.exe",
    ffprobePath: "W:\\SiaoVPlay\\runtimes\\ffmpeg\\bin\\ffprobe.exe",
    version: "ffmpeg 8.1.1",
    errorMessage: null,
  });
  desktopMocks.setMainWindowMediaTitle.mockResolvedValue(undefined);
  desktopMocks.listProjects.mockResolvedValue([project]);
  desktopMocks.getProject.mockResolvedValue(project);
  desktopMocks.chooseLocalVideo.mockResolvedValue(null);
  desktopMocks.chooseSubtitleFile.mockResolvedValue(null);
  desktopMocks.createLocalProject.mockResolvedValue(project);
  desktopMocks.inspectRemoteMediaUrl.mockResolvedValue(remotePreview);
  desktopMocks.importRemoteMediaUrl.mockResolvedValue(remoteProject);
  desktopMocks.cancelRemoteMediaImport.mockResolvedValue(true);
  desktopMocks.inspectYouTubeUrl.mockResolvedValue(youtubePreview);
  desktopMocks.importYouTubeUrl.mockResolvedValue(remoteProject);
  desktopMocks.cancelYouTubeImport.mockResolvedValue(true);
  desktopMocks.ensureProjectPoster.mockResolvedValue({
    ...project,
    mediaSource: {
      ...project.mediaSource,
      posterPath: "W:\\SiaoVPlay\\app-data\\media-cache\\project\\poster.jpg",
    },
  });
  desktopMocks.markProjectOpened.mockImplementation(async (projectId) =>
    projectId === remoteProject.id ? remoteProject : project,
  );
  desktopMocks.prepareProjectMedia.mockImplementation(async (projectId) => ({
    ...preparation,
    inspection: {
      ...preparation.inspection,
      projectId,
      mediaSourceId:
        projectId === remoteProject.id
          ? remoteProject.mediaSource.id
          : project.mediaSource.id,
    },
    playbackPath:
      projectId === remoteProject.id
        ? remoteProject.mediaSource.locator
        : preparation.playbackPath,
  }));
  desktopMocks.updatePlaybackState.mockResolvedValue(project);
  desktopMocks.deleteProject.mockResolvedValue({
    projectId: project.id,
    deleted: true,
    sourceMediaDeleted: false,
    cachedMediaDeleted: false,
  });
  desktopMocks.inspectSubtitleFile.mockResolvedValue(subtitlePreview);
  desktopMocks.importSubtitleFile.mockResolvedValue(subtitleVersion);
  desktopMocks.inspectEmbeddedSubtitle.mockResolvedValue(
    embeddedSubtitlePreview,
  );
  desktopMocks.importEmbeddedSubtitle.mockResolvedValue({
    ...subtitleVersion,
    sourceKind: "embedded",
    sourceLabel: embeddedSubtitlePreview.sourceLabel,
  });
  desktopMocks.listSubtitleVersions.mockResolvedValue([]);
  desktopMocks.reviseSubtitleVersion.mockResolvedValue(subtitleVersion);
  desktopMocks.restoreSubtitleVersion.mockResolvedValue(subtitleVersion);
  desktopMocks.reconcileExternalAgentResults.mockResolvedValue([]);
  desktopMocks.openExternalResultDirectory.mockResolvedValue(true);
  desktopMocks.getTranscriptionRuntimeStatus.mockResolvedValue({
    available: true,
    preferredBackend: "vulkan",
    runtimes: [
      {
        backend: "vulkan",
        available: true,
        version: "1.9.1-siaocut.1",
        errorMessage: null,
      },
      {
        backend: "cpu",
        available: true,
        version: "1.9.1-siaocut.1",
        errorMessage: null,
      },
    ],
    models: [
      { modelKind: "small", available: true, errorMessage: null },
      { modelKind: "base", available: true, errorMessage: null },
    ],
  });
  desktopMocks.listTranscriptionJobs.mockResolvedValue([]);
  desktopMocks.startTranscription.mockResolvedValue(transcriptionJob);
  desktopMocks.getTranscriptionJob.mockResolvedValue(transcriptionJob);
  desktopMocks.cancelTranscriptionJob.mockResolvedValue({
    ...transcriptionJob,
    status: "cancelled",
    stage: "cancelled",
    errorCode: "cancelled",
    errorMessage: "转写任务已取消",
    completedAtMs: 1_785_354_210_000,
  });
  desktopMocks.resumeTranscriptionJob.mockResolvedValue(transcriptionJob);
  desktopMocks.getCodexRuntimeStatus.mockResolvedValue({
    available: true,
    authenticated: true,
    supported: true,
    version: "codex-cli 0.145.0",
    authMode: "chatgpt",
    minimumVersion: "0.145.0",
    errorCode: null,
    errorMessage: null,
  });
  desktopMocks.listTranslationTasks.mockResolvedValue([]);
  desktopMocks.prepareTranslationTask.mockResolvedValue(translationTask);
  desktopMocks.startCodexTranslationTask.mockResolvedValue({
    ...translationTask,
    status: "running",
    stage: "starting",
    progress: 0.01,
    startedAtMs: 1_785_354_301_000,
  });
  desktopMocks.getTranslationTask.mockResolvedValue({
    ...translationTask,
    status: "running",
    stage: "translating_batch_1_of_1",
    progress: 0.4,
    startedAtMs: 1_785_354_301_000,
  });
  desktopMocks.cancelTranslationTask.mockResolvedValue({
    ...translationTask,
    status: "cancelled",
    stage: "cancelled",
    completedAtMs: 1_785_354_302_000,
  });
  desktopMocks.resumeCodexTranslationTask.mockResolvedValue({
    ...translationTask,
    status: "running",
    stage: "starting",
    progress: 0.01,
    startedAtMs: 1_785_354_303_000,
  });
  desktopMocks.readTranslationPrompt.mockResolvedValue(
    "# SiaoVPlay 字幕翻译任务\n\n只返回 JSON。",
  );
  desktopMocks.chooseTranslationResultFile.mockResolvedValue(null);
  desktopMocks.importTranslationResult.mockResolvedValue({
    task: completedTranslationTask,
    subtitleVersion: translatedVersion,
    validation: completedTranslationTask.validation,
  });
  desktopMocks.listExplanationTasks.mockResolvedValue([]);
  desktopMocks.listExplanations.mockResolvedValue([]);
  desktopMocks.prepareExplanationTask.mockResolvedValue(explanationTask);
  desktopMocks.startCodexExplanationTask.mockResolvedValue({
    ...explanationTask,
    status: "running",
    stage: "running",
    progress: 0.1,
    startedAtMs: 1_785_354_321_000,
  });
  desktopMocks.getExplanationTask.mockResolvedValue({
    ...explanationTask,
    status: "running",
    stage: "running",
    progress: 0.4,
    startedAtMs: 1_785_354_321_000,
  });
  desktopMocks.readExplanationPrompt.mockResolvedValue(
    "# SiaoVPlay 当前场景解释任务\n\n只返回 JSON。",
  );
  desktopMocks.openExplanationMaterials.mockResolvedValue(true);
  desktopMocks.getExplanation.mockResolvedValue(explanation);
  desktopMocks.chooseExplanationResultFile.mockResolvedValue(null);
  desktopMocks.importExplanationResult.mockResolvedValue({
    task: {
      ...explanationTask,
      handoffKind: "manual",
      status: "completed",
      stage: "completed",
      progress: 1,
      outputExplanationId: explanation.id,
      completedAtMs: 1_785_354_330_000,
    },
    explanation,
  });
  desktopMocks.cancelExplanationTask.mockResolvedValue({
    ...explanationTask,
    status: "cancelled",
    stage: "cancelled",
    completedAtMs: 1_785_354_322_000,
  });
  desktopMocks.resumeCodexExplanationTask.mockResolvedValue({
    ...explanationTask,
    status: "running",
    stage: "running",
    progress: 0.1,
    startedAtMs: 1_785_354_323_000,
  });
  desktopMocks.listLearningTasks.mockResolvedValue([]);
  desktopMocks.listDictionaryEntries.mockResolvedValue([]);
  desktopMocks.listLearningCards.mockResolvedValue([]);
  desktopMocks.prepareLearningTask.mockResolvedValue(learningTask);
  desktopMocks.startCodexLearningTask.mockResolvedValue({
    ...learningTask,
    status: "running",
    stage: "running",
    progress: 0.1,
    startedAtMs: 1_785_354_341_000,
  });
  desktopMocks.getLearningTask.mockResolvedValue({
    ...learningTask,
    status: "running",
    stage: "running",
    progress: 0.4,
    startedAtMs: 1_785_354_341_000,
  });
  desktopMocks.readLearningPrompt.mockResolvedValue(
    "# SiaoVPlay 语境词义查询任务\n\n只返回 JSON。",
  );
  desktopMocks.getDictionaryEntry.mockResolvedValue(dictionaryEntry);
  desktopMocks.chooseLearningResultFile.mockResolvedValue(null);
  desktopMocks.chooseLearningExportDirectory.mockResolvedValue(null);
  desktopMocks.importLearningResult.mockResolvedValue({
    task: {
      ...learningTask,
      handoffKind: "manual",
      status: "completed",
      stage: "completed",
      progress: 1,
      outputDictionaryEntryId: dictionaryEntry.id,
      completedAtMs: 1_785_354_350_000,
    },
    dictionaryEntry,
  });
  desktopMocks.cancelLearningTask.mockResolvedValue({
    ...learningTask,
    status: "cancelled",
    stage: "cancelled",
    completedAtMs: 1_785_354_342_000,
  });
  desktopMocks.resumeCodexLearningTask.mockResolvedValue({
    ...learningTask,
    status: "running",
    stage: "running",
    progress: 0.1,
    startedAtMs: 1_785_354_343_000,
  });
  desktopMocks.createLearningCard.mockResolvedValue(learningCard);
  desktopMocks.getLearningCard.mockResolvedValue(learningCard);
  desktopMocks.deleteLearningCard.mockResolvedValue(true);
  desktopMocks.exportLearningCards.mockResolvedValue({
    directory: "W:\\exports\\SiaoVPlay-learning-rain-platform",
    jsonPath:
      "W:\\exports\\SiaoVPlay-learning-rain-platform\\learning-cards.json",
    markdownPath:
      "W:\\exports\\SiaoVPlay-learning-rain-platform\\learning-cards.md",
    cardCount: 1,
  });
  desktopMocks.chooseSubtitleDeliveryDirectory.mockResolvedValue(null);
  desktopMocks.exportSubtitles.mockResolvedValue(subtitleExport);
  desktopMocks.startSubtitleBurn.mockResolvedValue(burnJob);
  desktopMocks.getSubtitleBurnJob.mockResolvedValue(burnJob);
  desktopMocks.listSubtitleBurnJobs.mockResolvedValue([]);
  desktopMocks.cancelSubtitleBurnJob.mockResolvedValue({
    ...burnJob,
    status: "cancelled",
    stage: "cancelled",
    errorCode: "subtitle_burn_cancelled",
    errorMessage: "字幕烧录已取消",
    completedAtMs: 1_785_354_381_000,
  });
  desktopMocks.resumeSubtitleBurnJob.mockResolvedValue(burnJob);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

describe("App", () => {
  it("uses a collapsible desktop shell and keeps folder import disabled", async () => {
    render(<App />);

    expect(
      screen.getByRole("banner", { name: "应用命令栏" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "打开文件夹，文件夹与剧集导入将在 Phase 7D 启用",
      }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "折叠媒体库导航" }),
    );
    expect(
      screen.getByRole("button", { name: "展开媒体库导航" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("雨站台")).toBeInTheDocument();
  });

  it("shows a compact media library backed by real projects", async () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: "媒体库",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "继续观看" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未归类视频" })).toBeInTheDocument();
    expect(screen.queryByLabelText("媒体导入说明")).not.toBeInTheDocument();
    expect(await screen.findByText("雨站台")).toBeInTheDocument();
    expect(screen.getByText("本地媒体工具可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开文件" })).toBeEnabled();
    expect(screen.getByLabelText("观看进度 23%")).toBeInTheDocument();
    await waitFor(() =>
      expect(desktopMocks.ensureProjectPoster).toHaveBeenCalledWith(project.id),
    );
    await waitFor(() =>
      expect(document.querySelector(".poster-image")).toHaveAttribute(
        "src",
        expect.stringContaining("poster.jpg"),
      ),
    );
  });

  it("prepares a project before opening the player", async () => {
    render(<App />);
    const [openProject] = await screen.findAllByRole("button", {
      name: "打开 雨站台",
    });
    fireEvent.click(openProject);

    expect(await screen.findByText("正在确认视频画面")).toBeInTheDocument();
    expect(desktopMocks.markProjectOpened).toHaveBeenCalledWith(project.id);
    expect(desktopMocks.prepareProjectMedia).toHaveBeenCalledWith(
      project.id,
      false,
    );
    expect(screen.getByText(/H264\s*\/ AAC/)).toBeInTheDocument();
    await waitFor(() =>
      expect(desktopMocks.setMainWindowMediaTitle).toHaveBeenLastCalledWith(
        "雨站台",
      ),
    );
  });

  it("keeps optional drawers closed and preserves the mounted video", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));

    const video = await screen.findByLabelText("视频画面，单击播放或暂停");
    expect(screen.queryByLabelText("剧集抽屉")).not.toBeInTheDocument();

    const episodesButton = screen.getByRole("button", { name: "剧集" });
    fireEvent.click(episodesButton);
    expect(screen.getByLabelText("剧集抽屉")).toBeInTheDocument();
    expect(episodesButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("视频画面，单击播放或暂停")).toBe(video);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("剧集抽屉")).not.toBeInTheDocument();
    expect(screen.getByLabelText("视频画面，单击播放或暂停")).toBe(video);
  });

  it("supports desktop playback shortcuts and a scoped context menu", async () => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    const requestFullscreen = vi
      .spyOn(HTMLElement.prototype, "requestFullscreen")
      .mockResolvedValue(undefined);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));

    const video = await screen.findByLabelText("视频画面，单击播放或暂停");
    fireEvent.contextMenu(video, { clientX: 320, clientY: 220 });
    expect(
      screen.getByRole("menu", { name: "播放器右键菜单" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("menu", { name: "播放器右键菜单" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "m" });
    expect(video).toHaveProperty("muted", true);
    fireEvent.keyDown(window, { key: "]" });
    expect(video).toHaveProperty("playbackRate", 1.25);

    const speed = screen.getByRole("combobox");
    fireEvent.keyDown(speed, { key: "[" });
    expect(video).toHaveProperty("playbackRate", 1.25);

    fireEvent.keyDown(window, { key: "f" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(video);
    expect(requestFullscreen).toHaveBeenCalledTimes(2);
    requestFullscreen.mockRestore();
    Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
  });

  it("toggles playback from the video surface and keeps the button label in sync", async () => {
    let paused = true;
    const pausedState = vi
      .spyOn(HTMLMediaElement.prototype, "paused", "get")
      .mockImplementation(() => paused);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(async function (this: HTMLMediaElement) {
        paused = false;
        fireEvent.play(this);
      });
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(function (this: HTMLMediaElement) {
        paused = true;
        fireEvent.pause(this);
      });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    const video = await screen.findByLabelText("视频画面，单击播放或暂停");

    fireEvent.click(video);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();

    pausedState.mockRestore();
    play.mockRestore();
    pause.mockRestore();
  });

  it("shows original, Chinese, and bilingual subtitles and persists the choice", async () => {
    const captionProject: Project = {
      ...project,
      playbackState: {
        ...project.playbackState,
        positionMs: 500,
      },
    };
    desktopMocks.listProjects.mockResolvedValue([captionProject]);
    desktopMocks.markProjectOpened.mockResolvedValue(captionProject);
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);
    desktopMocks.updatePlaybackState.mockImplementation(
      async (_projectId: string, values: Project["playbackState"]) => ({
        ...captionProject,
        playbackState: {
          ...values,
          updatedAtMs: 1_785_354_400_000,
        },
      }),
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));

    expect(await screen.findByText("明天在车站前见吧。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示原文字幕" }));
    expect(await screen.findByText("待っていたの？")).toBeInTheDocument();
    await waitFor(() =>
      expect(desktopMocks.updatePlaybackState).toHaveBeenLastCalledWith(
        project.id,
        expect.objectContaining({ subtitleMode: "original" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "显示双语字幕" }));
    expect(screen.getByText("待っていたの？")).toBeInTheDocument();
    expect(screen.getByText("明天在车站前见吧。")).toBeInTheDocument();
    await waitFor(() =>
      expect(desktopMocks.updatePlaybackState).toHaveBeenLastCalledWith(
        project.id,
        expect.objectContaining({ subtitleMode: "bilingual" }),
      ),
    );
  });

  it("exports an explicitly confirmed bilingual WebVTT subtitle", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);
    desktopMocks.chooseSubtitleDeliveryDirectory.mockResolvedValue(
      "W:\\exports",
    );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "导出字幕与视频" }),
    );

    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "双语" }));
    fireEvent.change(screen.getByRole("combobox", { name: "字幕文件格式" }), {
      target: { value: "vtt" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /确认使用以上字幕版本/,
      }),
    );
    const exportButton = screen.getByRole("button", {
      name: "选择位置并导出",
    });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(
        desktopMocks.chooseSubtitleDeliveryDirectory,
      ).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(desktopMocks.exportSubtitles).toHaveBeenCalledWith(
        project.id,
        "bilingual",
        "vtt",
        subtitleVersion.id,
        translatedVersion.id,
        "W:\\exports",
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "字幕已导出" }),
    ).toBeInTheDocument();
    expect(screen.getByText(subtitleExport.filePath)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  });

  it("starts and cancels a background subtitle burn job", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);
    desktopMocks.chooseSubtitleDeliveryDirectory.mockResolvedValue(
      "W:\\exports",
    );
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "导出字幕与视频" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /烧录视频/ }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /确认使用以上字幕版本/,
      }),
    );
    const burnButton = screen.getByRole("button", {
      name: "选择位置并开始烧录",
    });
    await waitFor(() => expect(burnButton).toBeEnabled());
    fireEvent.click(burnButton);

    await waitFor(() =>
      expect(
        desktopMocks.chooseSubtitleDeliveryDirectory,
      ).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(desktopMocks.startSubtitleBurn).toHaveBeenCalledWith(
        project.id,
        "translation",
        null,
        translatedVersion.id,
        "W:\\exports",
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "等待开始" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消烧录" }));
    await waitFor(() =>
      expect(desktopMocks.cancelSubtitleBurnJob).toHaveBeenCalledWith(
        burnJob.id,
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "任务已取消" }),
    ).toBeInTheDocument();
  });

  it("restores an interrupted burn job and retries it from the dialog", async () => {
    const interruptedJob: SubtitleBurnJob = {
      ...burnJob,
      status: "interrupted",
      stage: "interrupted",
      errorCode: "subtitle_burn_interrupted",
      errorMessage: "应用上次关闭时烧录仍在进行。",
    };
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);
    desktopMocks.listSubtitleBurnJobs.mockResolvedValue([interruptedJob]);
    desktopMocks.resumeSubtitleBurnJob.mockResolvedValue(burnJob);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "导出字幕与视频" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /最近一次烧录/ }));
    expect(
      await screen.findByRole("heading", { name: "上次任务已中断" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新开始" }));

    await waitFor(() =>
      expect(desktopMocks.resumeSubtitleBurnJob).toHaveBeenCalledWith(
        interruptedJob.id,
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "等待开始" }),
    ).toBeInTheDocument();
  });

  it("keeps watching quiet until the user opens understanding and confirms the Codex scope", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));

    expect(screen.queryByLabelText("场景理解")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "理解" }));

    expect(await screen.findByLabelText("场景理解")).toBeInTheDocument();
    expect(screen.getByText("仅使用 00:42 之前")).toBeInTheDocument();
    expect(
      screen.getByText("不包含完整视频、音频、源媒体路径、数据库或凭证。"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("本机 Codex")).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "确认范围并理解当前场景" }),
    );
    await waitFor(() =>
      expect(desktopMocks.prepareExplanationTask).toHaveBeenCalledWith(
        project.id,
        "codex",
        42_000,
      ),
    );
    await waitFor(() =>
      expect(desktopMocks.startCodexExplanationTask).toHaveBeenCalledWith(
        explanationTask.id,
      ),
    );
    expect(
      await screen.findByText("正在结合字幕和关键帧理解当前场景"),
    ).toBeInTheDocument();
  });

  it("keeps understanding and learning available before subtitles exist", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));

    const understandButton = await screen.findByRole("button", {
      name: "理解",
    });
    const learnButton = screen.getByRole("button", { name: "学习" });
    expect(understandButton).toBeEnabled();
    expect(learnButton).toBeEnabled();

    fireEvent.click(understandButton);
    expect(
      await screen.findByText("场景理解以当前播放点之前的真实字幕和关键帧为依据。"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "生成或导入原文字幕" }),
    );
    expect(
      await screen.findByRole("heading", { name: "准备原文字幕" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(learnButton);
    expect(
      await screen.findByText("词义查询只使用真实原文字幕和已有的简体中文字幕。"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "生成或导入原文字幕" }),
    );
    expect(
      await screen.findByRole("heading", { name: "准备原文字幕" }),
    ).toBeInTheDocument();
  });

  it("copies a manual explanation prompt, exposes controlled frames, and imports JSON", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);
    desktopMocks.prepareExplanationTask.mockResolvedValue({
      ...explanationTask,
      handoffKind: "manual",
      status: "awaiting_external_result",
      stage: "awaiting_external_result",
      receiverLabel: "手动选择的外部 Agent",
    });
    desktopMocks.chooseExplanationResultFile.mockResolvedValue(
      "W:\\SiaoVPlay\\handoff\\explanation.json",
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "理解" }));
    fireEvent.click(await screen.findByRole("button", { name: /复制提示词/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "确认范围并理解当前场景" }),
    );

    expect(
      await screen.findByText("复制文字并按提示附上关键帧"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "打开自动返回目录" }),
    );
    expect(desktopMocks.openExternalResultDirectory).toHaveBeenCalledWith(
      "explanation",
      explanationTask.id,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制完整提示词" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("当前场景解释任务"),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "打开 1 张关键帧" }));
    expect(desktopMocks.openExplanationMaterials).toHaveBeenCalledWith(
      explanationTask.id,
    );
    fireEvent.click(screen.getByRole("button", { name: /手动选择 JSON/ }));
    expect(await screen.findByText("explanation.json")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查并显示解释" }));

    await waitFor(() =>
      expect(desktopMocks.importExplanationResult).toHaveBeenCalledWith(
        explanationTask.id,
        "W:\\SiaoVPlay\\handoff\\explanation.json",
      ),
    );
    expect(
      await screen.findByText("结合当前剧情的可能解读"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("结合当前语气，这个约定对人物可能很重要。"),
    ).toBeInTheDocument();
  });

  it("keeps learning quiet until the user selects the current subtitle and confirms the Codex scope", async () => {
    const captionProject: Project = {
      ...project,
      playbackState: {
        ...project.playbackState,
        positionMs: 500,
      },
    };
    desktopMocks.listProjects.mockResolvedValue([captionProject]);
    desktopMocks.markProjectOpened.mockResolvedValue(captionProject);
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));

    expect(screen.queryByLabelText("语言学习")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "学习" }));

    expect(await screen.findByLabelText("语言学习")).toBeInTheDocument();
    expect(screen.getByLabelText("要查询的原文")).toHaveValue("待っていたの？");
    expect(
      screen.getByText("不包含视频、音频、本机媒体路径、数据库或凭证。"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认范围并查询" }));
    await waitFor(() =>
      expect(desktopMocks.prepareLearningTask).toHaveBeenCalledWith(
        project.id,
        "codex",
        subtitleVersion.segments[0].id,
        "待っていたの？",
        "sentence",
        500,
      ),
    );
    await waitFor(() =>
      expect(desktopMocks.startCodexLearningTask).toHaveBeenCalledWith(
        learningTask.id,
      ),
    );
    expect(
      await screen.findByText("正在查询这句台词里的用法"),
    ).toBeInTheDocument();
  });

  it("imports a manual learning result and supports card save, jump, export, and delete", async () => {
    const captionProject: Project = {
      ...project,
      playbackState: {
        ...project.playbackState,
        positionMs: 500,
      },
    };
    desktopMocks.listProjects.mockResolvedValue([captionProject]);
    desktopMocks.markProjectOpened.mockResolvedValue(captionProject);
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);
    desktopMocks.prepareLearningTask.mockResolvedValue({
      ...learningTask,
      handoffKind: "manual",
      status: "awaiting_external_result",
      stage: "awaiting_external_result",
      receiverLabel: "自行选择的工具",
    });
    desktopMocks.chooseLearningResultFile.mockResolvedValue(
      "W:\\SiaoVPlay\\handoff\\learning.json",
    );
    desktopMocks.chooseLearningExportDirectory.mockResolvedValue("W:\\exports");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "学习" }));
    fireEvent.click(await screen.findByRole("button", { name: /复制提示词/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认范围并查询" }));

    expect(
      await screen.findByText("复制提示词后，可自动检测 result.json"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "打开自动返回目录" }),
    );
    expect(desktopMocks.openExternalResultDirectory).toHaveBeenCalledWith(
      "learning",
      learningTask.id,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制完整提示词" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("语境词义查询任务"),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /手动选择 JSON/ }));
    expect(await screen.findByText("learning.json")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查并显示词义" }));

    expect(
      await screen.findByText("结合当前台词，询问对方是否一直在等待。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收藏台词和场景" }));
    expect(
      await screen.findByAltText("待っていたの？ 的场景截图"),
    ).toBeInTheDocument();
    expect(desktopMocks.createLearningCard).toHaveBeenCalledWith(
      project.id,
      dictionaryEntry.id,
    );

    fireEvent.click(screen.getByRole("button", { name: "跳回" }));
    expect(screen.getByLabelText("播放进度")).toHaveValue("900");

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    await waitFor(() =>
      expect(desktopMocks.exportLearningCards).toHaveBeenCalledWith(
        project.id,
        "W:\\exports",
      ),
    );
    expect(
      await screen.findByText(/已导出 1 张卡片到/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(desktopMocks.deleteLearningCard).toHaveBeenCalledWith(
        project.id,
        learningCard.id,
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByAltText("待っていたの？ 的场景截图"),
      ).not.toBeInTheDocument(),
    );
  });

  it("automatically detects, validates, and displays an external learning result", async () => {
    const captionProject: Project = {
      ...project,
      playbackState: {
        ...project.playbackState,
        positionMs: 500,
      },
    };
    const waitingTask: LearningTask = {
      ...learningTask,
      handoffKind: "manual",
      status: "awaiting_external_result",
      stage: "awaiting_external_result",
      receiverLabel: "手动选择的外部 Agent",
    };
    const validatingTask: LearningTask = {
      ...waitingTask,
      status: "validating",
      stage: "validating",
      progress: 0.9,
    };
    const completedTask: LearningTask = {
      ...validatingTask,
      status: "completed",
      stage: "completed",
      progress: 1,
      outputDictionaryEntryId: dictionaryEntry.id,
      completedAtMs: 1_785_354_350_000,
    };
    desktopMocks.listProjects.mockResolvedValue([captionProject]);
    desktopMocks.markProjectOpened.mockResolvedValue(captionProject);
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);
    desktopMocks.listLearningTasks.mockResolvedValue([waitingTask]);
    desktopMocks.getLearningTask
      .mockResolvedValueOnce(validatingTask)
      .mockResolvedValue(completedTask);
    desktopMocks.reconcileExternalAgentResults
      .mockResolvedValueOnce([
        {
          taskKind: "learning",
          taskId: waitingTask.id,
          projectId: project.id,
          status: "validating",
          outputId: null,
          message: "已检测到外部 Agent 返回，正在检查词义",
        },
      ])
      .mockResolvedValueOnce([
        {
          taskKind: "learning",
          taskId: waitingTask.id,
          projectId: project.id,
          status: "completed",
          outputId: dictionaryEntry.id,
          message: "已检测并导入外部 Agent 返回的词义结果",
        },
      ])
      .mockResolvedValue([]);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "学习" }));

    expect(await screen.findByText("等待其他 Agent 返回")).toBeInTheDocument();
    expect(
      await screen.findByText("正在检查查询范围和结果", {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "结合当前台词，询问对方是否一直在等待。",
        {},
        { timeout: 3_000 },
      ),
    ).toBeInTheDocument();
  });

  it("restores a completed learning result and saved card for the current subtitle", async () => {
    const captionProject: Project = {
      ...project,
      playbackState: {
        ...project.playbackState,
        positionMs: 500,
      },
    };
    desktopMocks.listProjects.mockResolvedValue([captionProject]);
    desktopMocks.markProjectOpened.mockResolvedValue(captionProject);
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);
    desktopMocks.listDictionaryEntries.mockResolvedValue([dictionaryEntry]);
    desktopMocks.listLearningCards.mockResolvedValue([learningCard]);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "学习" }));

    expect(
      await screen.findAllByText("结合当前台词，询问对方是否一直在等待。"),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: "已收藏" })).toBeDisabled();
    expect(
      screen.getByAltText("待っていたの？ 的场景截图"),
    ).toBeInTheDocument();
  });

  it("opens the local import dialog with Ctrl+O", async () => {
    render(<App />);
    await screen.findByText("雨站台");

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });

    await waitFor(() =>
      expect(desktopMocks.chooseLocalVideo).toHaveBeenCalled(),
    );
  });

  it("opens a local video passed by the desktop process", async () => {
    desktopMocks.getAppStatus.mockResolvedValue({
      appName: "SiaoVPlay",
      version: "0.1.0",
      platform: "windows-desktop",
      dataDirectory: "W:\\SiaoVPlay\\app-data",
      startupMediaPath: project.mediaSource.locator,
    });
    desktopMocks.listProjects.mockResolvedValue([]);

    render(<App />);

    await waitFor(() =>
      expect(desktopMocks.createLocalProject).toHaveBeenCalledWith(
        project.mediaSource.locator,
      ),
    );
    expect(desktopMocks.prepareProjectMedia).toHaveBeenCalledWith(
      project.id,
      false,
    );
  });

  it("preflights and imports a public HTTPS media URL", async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "粘贴视频 URL" }),
    );

    fireEvent.change(screen.getByLabelText("视频 URL"), {
      target: { value: remotePreview.originalUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查 URL" }));

    await waitFor(() =>
      expect(desktopMocks.inspectRemoteMediaUrl).toHaveBeenCalledWith(
        remotePreview.originalUrl,
      ),
    );
    expect(await screen.findByText("媒体文件")).toBeInTheDocument();
    expect(screen.getByText("cdn.example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));

    await waitFor(() =>
      expect(desktopMocks.importRemoteMediaUrl).toHaveBeenCalledWith(
        remotePreview.originalUrl,
        remotePreview.previewToken,
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(desktopMocks.prepareProjectMedia).toHaveBeenCalledWith(
        remoteProject.id,
        false,
      ),
    );
  });

  it("cancels an active remote media download", async () => {
    desktopMocks.importRemoteMediaUrl.mockReturnValue(new Promise(() => {}));
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "粘贴视频 URL" }),
    );
    fireEvent.change(screen.getByLabelText("视频 URL"), {
      target: { value: remotePreview.originalUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查 URL" }));
    await screen.findByText("媒体文件");
    fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));

    fireEvent.click(await screen.findByRole("button", { name: "取消导入" }));
    const operationId = desktopMocks.importRemoteMediaUrl.mock.calls[0][2];
    await waitFor(() =>
      expect(desktopMocks.cancelRemoteMediaImport).toHaveBeenCalledWith(
        operationId,
      ),
    );
    expect(
      await screen.findByRole("button", { name: "正在取消…" }),
    ).toBeDisabled();
  });

  it("requires confirmation before importing a public YouTube single video", async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "粘贴视频 URL" }),
    );
    fireEvent.change(screen.getByLabelText("视频 URL"), {
      target: { value: youtubePreview.originalUrl },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查 URL" }));

    await waitFor(() =>
      expect(desktopMocks.inspectYouTubeUrl).toHaveBeenCalledWith(
        youtubePreview.originalUrl,
      ),
    );
    expect(desktopMocks.importYouTubeUrl).not.toHaveBeenCalled();
    expect(await screen.findByText("公开单视频")).toBeInTheDocument();
    expect(screen.getByText("0:19")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
    await waitFor(() =>
      expect(desktopMocks.importYouTubeUrl).toHaveBeenCalledWith(
        youtubePreview.originalUrl,
        youtubePreview.previewToken,
        expect.any(String),
      ),
    );
  });

  it("states that deleting a project keeps the source video", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));

    expect(
      screen.getByRole("heading", { name: "删除这个本地项目？" }),
    ).toBeInTheDocument();
    expect(screen.getByText("源视频不会被删除")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除项目" }));

    await waitFor(() =>
      expect(desktopMocks.deleteProject).toHaveBeenCalledWith(project.id),
    );
    expect(
      await screen.findByText("项目已删除，源视频保持不变。"),
    ).toBeInTheDocument();
  });

  it("preflights and imports a local original subtitle", async () => {
    desktopMocks.chooseSubtitleFile.mockResolvedValue(
      "W:\\media\\rain-platform.ja.srt",
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加字幕" }));

    fireEvent.click(screen.getByRole("button", { name: /选择字幕文件/ }));
    await waitFor(() =>
      expect(desktopMocks.chooseSubtitleFile).toHaveBeenCalled(),
    );
    fireEvent.change(screen.getByLabelText("原文语言"), {
      target: { value: "ja" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查字幕" }));

    await waitFor(() =>
      expect(desktopMocks.inspectSubtitleFile).toHaveBeenCalledWith(
        project.id,
        "W:\\media\\rain-platform.ja.srt",
        "ja",
      ),
    );
    expect(
      await screen.findByText("时间轴和媒体范围检查通过，可以导入。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导入原文字幕" }));

    await waitFor(() =>
      expect(desktopMocks.importSubtitleFile).toHaveBeenCalled(),
    );
    expect(
      await screen.findByText("已导入 1 条原文字幕，保存为版本 1。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "原文字幕 · 1" }),
    ).toBeInTheDocument();
  });

  it("starts and cancels local Japanese subtitle generation", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加字幕" }));
    fireEvent.click(screen.getByRole("tab", { name: "从视频生成" }));

    expect(await screen.findByText("语音识别只在本机运行")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/视频原声语言/), {
      target: { value: "ja" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成原文字幕" }));

    await waitFor(() =>
      expect(desktopMocks.startTranscription).toHaveBeenCalledWith(
        project.id,
        "ja",
        "small",
        false,
      ),
    );
    expect(await screen.findByText("正在准备音轨")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
    await waitFor(() =>
      expect(desktopMocks.cancelTranscriptionJob).toHaveBeenCalledWith(
        transcriptionJob.id,
      ),
    );
    expect(await screen.findByText("任务已取消")).toBeInTheDocument();
    expect(
      screen.getByText("临时音频和识别文件已经清理。"),
    ).toBeInTheDocument();
  });

  it("refreshes player subtitles when generation finishes after the dialog closes", async () => {
    const completedJob: TranscriptionJob = {
      ...transcriptionJob,
      status: "completed",
      stage: "completed",
      progress: 1,
      subtitleVersionId: subtitleVersion.id,
      completedAtMs: 1_785_354_220_000,
    };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加字幕" }));
    fireEvent.click(screen.getByRole("tab", { name: "从视频生成" }));
    fireEvent.change(await screen.findByLabelText(/视频原声语言/), {
      target: { value: "ja" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成原文字幕" }));

    await waitFor(() =>
      expect(desktopMocks.startTranscription).toHaveBeenCalled(),
    );
    desktopMocks.getTranscriptionJob.mockResolvedValue(completedJob);
    desktopMocks.listSubtitleVersions.mockResolvedValue([subtitleVersion]);

    expect(screen.getAllByRole("button", { name: "关闭" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() =>
      expect(desktopMocks.getTranscriptionJob).toHaveBeenCalledWith(
        transcriptionJob.id,
      ),
    );
    expect(
      await screen.findByText("已生成 1 条原文字幕草稿，可以开始抽查。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "原文字幕 · 1" }),
    ).toBeInTheDocument();
  });

  it("keeps tracking a transcription created after its dialog closes", async () => {
    const completedJob: TranscriptionJob = {
      ...transcriptionJob,
      status: "completed",
      stage: "completed",
      progress: 1,
      subtitleVersionId: subtitleVersion.id,
      completedAtMs: 1_785_354_220_000,
    };
    let resolveStart: (job: TranscriptionJob) => void = () => undefined;
    let resolveVersions: (versions: SubtitleVersion[]) => void = () =>
      undefined;
    desktopMocks.startTranscription.mockImplementation(
      () =>
        new Promise<TranscriptionJob>((resolve) => {
          resolveStart = resolve;
        }),
    );
    desktopMocks.getTranscriptionJob.mockResolvedValue(completedJob);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加字幕" }));
    fireEvent.click(screen.getByRole("tab", { name: "从视频生成" }));
    fireEvent.change(await screen.findByLabelText(/视频原声语言/), {
      target: { value: "auto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成原文字幕" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    desktopMocks.listSubtitleVersions.mockImplementation(
      () =>
        new Promise<SubtitleVersion[]>((resolve) => {
          resolveVersions = resolve;
        }),
    );
    resolveStart(transcriptionJob);

    await waitFor(() =>
      expect(desktopMocks.getTranscriptionJob).toHaveBeenCalledWith(
        transcriptionJob.id,
      ),
    );
    resolveVersions([subtitleVersion]);
    expect(
      await screen.findByText("已生成 1 条原文字幕草稿，可以开始抽查。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "原文字幕 · 1" }),
    ).toBeInTheDocument();
  });

  it("offers automatic language detection for mixed-language tutorials", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加字幕" }));
    fireEvent.click(screen.getByRole("tab", { name: "从视频生成" }));

    fireEvent.change(await screen.findByLabelText(/视频原声语言/), {
      target: { value: "auto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成原文字幕" }));

    await waitFor(() =>
      expect(desktopMocks.startTranscription).toHaveBeenCalledWith(
        project.id,
        "auto",
        "small",
        false,
      ),
    );
  });

  it("uses a supported embedded text subtitle track", async () => {
    desktopMocks.prepareProjectMedia.mockResolvedValue({
      ...preparation,
      inspection: {
        ...preparation.inspection,
        probe: {
          ...preparation.inspection.probe,
          subtitleStreams: [
            {
              index: 2,
              codecName: "subrip",
              language: "jpn",
              kind: "text",
            },
            {
              index: 3,
              codecName: "hdmv_pgs_subtitle",
              language: "eng",
              kind: "image",
            },
          ],
        },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加字幕" }));
    fireEvent.click(screen.getByRole("button", { name: /内嵌字幕轨 2/ }));
    expect(
      screen.getByText("检测到 1 条图片或未知格式字幕轨，MVP 暂不支持提取。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查字幕" }));

    await waitFor(() =>
      expect(desktopMocks.inspectEmbeddedSubtitle).toHaveBeenCalledWith(
        project.id,
        2,
        "ja",
      ),
    );
    expect(
      await screen.findByText("内嵌字幕轨 2 · JPN · SUBRIP"),
    ).toBeInTheDocument();
  });

  it("routes Chinese subtitle generation to original subtitle preparation first", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "生成中文字幕" }),
    );

    expect(
      await screen.findByRole("heading", { name: "先准备原文字幕" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "准备原文字幕" }));
    expect(
      screen.getByRole("heading", { name: "准备原文字幕" }),
    ).toBeInTheDocument();
  });

  it("discloses the Codex material scope before starting and supports cancellation", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([subtitleVersion]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "生成中文字幕" }),
    );

    expect(await screen.findByText("将发送给本机 Codex")).toBeInTheDocument();
    expect(
      screen.getByText(
        "不包含视频、音频、本机媒体路径、项目数据库、凭证或账号信息。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("本机已就绪")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认范围并开始翻译" }));

    await waitFor(() =>
      expect(desktopMocks.prepareTranslationTask).toHaveBeenCalledWith(
        project.id,
        "codex",
      ),
    );
    await waitFor(() =>
      expect(desktopMocks.startCodexTranslationTask).toHaveBeenCalledWith(
        translationTask.id,
      ),
    );
    expect(await screen.findByText("正在启动本机 Codex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消翻译" }));
    await waitFor(() =>
      expect(desktopMocks.cancelTranslationTask).toHaveBeenCalledWith(
        translationTask.id,
      ),
    );
  });

  it("copies a manual task prompt and imports a selected JSON result", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([subtitleVersion]);
    desktopMocks.prepareTranslationTask.mockResolvedValue({
      ...translationTask,
      handoffKind: "manual",
      status: "awaiting_external_result",
      stage: "awaiting_external_result",
      receiverLabel: "手动选择的外部 Agent",
    });
    desktopMocks.chooseTranslationResultFile.mockResolvedValue(
      "W:\\SiaoVPlay\\handoff\\result.json",
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "生成中文字幕" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /复制任务提示词/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "生成完整任务提示词" }));

    expect(
      await screen.findByText("完整任务提示词已经生成"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制完整提示词" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("只返回 JSON"),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "打开自动返回目录" }),
    );
    expect(desktopMocks.openExternalResultDirectory).toHaveBeenCalledWith(
      "translation",
      translationTask.id,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /手动选择 JSON/ }),
    );
    expect(await screen.findByText("result.json")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查并生成中文字幕" }));

    await waitFor(() =>
      expect(desktopMocks.importTranslationResult).toHaveBeenCalledWith(
        translationTask.id,
        "W:\\SiaoVPlay\\handoff\\result.json",
      ),
    );
    expect(
      await screen.findByText("已生成 1 条简体中文字幕草稿，可以开始抽查。"),
    ).toBeInTheDocument();
  });

  it("shows a completed Chinese draft with source and translated samples", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      subtitleVersion,
      translatedVersion,
    ]);
    desktopMocks.listTranslationTasks.mockResolvedValue([
      completedTranslationTask,
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "中文字幕 · 1" }),
    );

    expect(
      await screen.findByText("翻译完成，可以开始抽查"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(subtitleVersion.segments[0].text),
    ).toBeInTheDocument();
    expect(screen.getByText("明天在车站前见吧。")).toBeInTheDocument();
    expect(
      screen.getByText("已检查 1 条字幕的任务、版本、范围和完整性。"),
    ).toBeInTheDocument();
  });

  it("resumes an interrupted Codex task from a clean batch baseline", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([subtitleVersion]);
    desktopMocks.listTranslationTasks.mockResolvedValue([
      {
        ...translationTask,
        status: "interrupted",
        stage: "interrupted",
        errorCode: "app_interrupted",
        errorMessage: "应用退出前 Codex 翻译尚未完成，可以重新开始",
        completedAtMs: 1_785_354_302_000,
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "生成中文字幕" }),
    );

    expect(await screen.findByText("处理已中断")).toBeInTheDocument();
    expect(
      screen.getByText(
        "重新开始会从受控任务包的第一批字幕开始，不复用未确认的中间结果。",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新开始本机翻译" }));
    await waitFor(() =>
      expect(desktopMocks.resumeCodexTranslationTask).toHaveBeenCalledWith(
        translationTask.id,
      ),
    );
  });

  it("saves a single subtitle correction and issue marker as a new version", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([subtitleVersion]);
    desktopMocks.reviseSubtitleVersion.mockResolvedValue({
      ...subtitleVersion,
      id: "83f706fc-554d-4de1-9a56-718685277117",
      versionNumber: 2,
      sourceLabel: "轻量修正 · 逐句修正",
      projectRevision: 2,
      parentVersionId: subtitleVersion.id,
      segments: [
        {
          ...subtitleVersion.segments[0],
          id: "99944ef3-4916-4f8c-8495-185484173b2f",
          text: "明日は駅の前で会いましょう。",
          issueKind: "incorrect",
        },
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "修正字幕" }));

    const editor = await screen.findByRole("textbox", { name: "原文字幕" });
    fireEvent.change(editor, {
      target: { value: "明日は駅の前で会いましょう。" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "问题标记" }), {
      target: { value: "incorrect" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存为新版本" }));

    await waitFor(() =>
      expect(desktopMocks.reviseSubtitleVersion).toHaveBeenCalledWith(
        project.id,
        subtitleVersion.id,
        project.revision,
        [
          {
            segmentId: subtitleVersion.segments[0].id,
            text: "明日は駅の前で会いましょう。",
            issueKind: "incorrect",
          },
        ],
        null,
        0,
      ),
    );
    expect(await screen.findByText("已保存原文字幕修正。")).toBeInTheDocument();
  });

  it("applies an exact global replacement through the revision workflow", async () => {
    desktopMocks.listSubtitleVersions.mockResolvedValue([subtitleVersion]);
    desktopMocks.reviseSubtitleVersion.mockResolvedValue({
      ...subtitleVersion,
      id: "1d451b5c-37fb-4aed-b151-a88192a263c0",
      versionNumber: 2,
      parentVersionId: subtitleVersion.id,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "修正字幕" }));
    fireEvent.click(await screen.findByRole("button", { name: "全局替换" }));
    fireEvent.change(screen.getByRole("textbox", { name: "查找" }), {
      target: { value: "駅前" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "替换为" }), {
      target: { value: "车站前" },
    });
    fireEvent.click(screen.getByRole("button", { name: "替换并创建新版本" }));

    await waitFor(() =>
      expect(desktopMocks.reviseSubtitleVersion).toHaveBeenCalledWith(
        project.id,
        subtitleVersion.id,
        project.revision,
        [],
        { findText: "駅前", replaceText: "车站前" },
        0,
      ),
    );
  });

  it("restores subtitle history by creating another immutable version", async () => {
    const currentVersion: SubtitleVersion = {
      ...subtitleVersion,
      id: "4586c09f-566e-453e-8ebf-43e2df96d9e8",
      versionNumber: 2,
      parentVersionId: subtitleVersion.id,
      sourceLabel: "轻量修正 · 逐句修正",
      isCurrent: true,
    };
    const historyVersion = { ...subtitleVersion, isCurrent: false };
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      currentVersion,
      historyVersion,
    ]);
    desktopMocks.restoreSubtitleVersion.mockResolvedValue({
      ...historyVersion,
      id: "7688d3bb-504b-484e-bf86-e5632a41d698",
      versionNumber: 3,
      parentVersionId: currentVersion.id,
      sourceLabel: "恢复自版本 1",
      isCurrent: true,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "修正字幕" }));
    fireEvent.click(await screen.findByRole("button", { name: "历史版本" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "恢复为新版本" }),
    );

    await waitFor(() =>
      expect(desktopMocks.restoreSubtitleVersion).toHaveBeenCalledWith(
        project.id,
        currentVersion.id,
        historyVersion.id,
        project.revision,
      ),
    );
    expect(
      await screen.findByText("已从版本 1 创建恢复版本。"),
    ).toBeInTheDocument();
  });

  it("hands only selected original segments to the retranslation task", async () => {
    const secondOriginalSegment = {
      ...subtitleVersion.segments[0],
      id: "ff14a28d-c2a2-47a8-b5ad-6a1f951f6b24",
      lineageId: "ff14a28d-c2a2-47a8-b5ad-6a1f951f6b24",
      ordinal: 2,
      startMs: 2_000,
      endMs: 3_400,
      text: "約束だからね。",
    };
    const originalWithSelection = {
      ...subtitleVersion,
      segments: [...subtitleVersion.segments, secondOriginalSegment],
    };
    const translationWithSelection = {
      ...translatedVersion,
      segments: [
        translatedVersion.segments[0],
        {
          ...translatedVersion.segments[0],
          id: "b7821c0b-b384-482f-b40e-49de8a54d6ee",
          lineageId: "b7821c0b-b384-482f-b40e-49de8a54d6ee",
          sourceSegmentId: secondOriginalSegment.id,
          ordinal: 2,
          startMs: 2_000,
          endMs: 3_400,
          text: "说好了哦。",
        },
      ],
    };
    desktopMocks.listSubtitleVersions.mockResolvedValue([
      originalWithSelection,
      translationWithSelection,
    ]);
    desktopMocks.prepareTranslationTask.mockResolvedValue({
      ...translationTask,
      authorizedSegmentIds: [subtitleVersion.segments[0].id],
      segmentCount: 1,
      baseTranslationVersionId: translationWithSelection.id,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(await screen.findByRole("button", { name: "修正字幕" }));
    fireEvent.click(await screen.findByRole("tab", { name: /原文字幕/ }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择第 0 条字幕重译" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "重新翻译选中字幕" }));

    expect(
      await screen.findByRole("heading", { name: "重新翻译选中字幕" }),
    ).toBeInTheDocument();
    expect(screen.getByText("只处理选中的 1 条原文字幕")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认范围并开始翻译" }));
    await waitFor(() =>
      expect(desktopMocks.prepareTranslationTask).toHaveBeenCalledWith(
        project.id,
        "codex",
        [subtitleVersion.segments[0].id],
      ),
    );
  });
});
