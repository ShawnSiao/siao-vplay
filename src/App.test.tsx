import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EmbeddedSubtitlePreview,
  MediaPreparation,
  Project,
  RemoteMediaPreview,
  SubtitleImportPreview,
  SubtitleVersion,
  TranscriptionJob,
  YouTubeMediaPreview,
} from "./types";

const desktopMocks = vi.hoisted(() => ({
  getAppStatus: vi.fn(),
  getMediaRuntimeStatus: vi.fn(),
  listProjects: vi.fn(),
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
  getTranscriptionRuntimeStatus: vi.fn(),
  startTranscription: vi.fn(),
  getTranscriptionJob: vi.fn(),
  listTranscriptionJobs: vi.fn(),
  cancelTranscriptionJob: vi.fn(),
  resumeTranscriptionJob: vi.fn(),
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
    locator:
      "W:\\SiaoVPlay\\app-data\\remote-media\\import-1\\source.mp4",
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
      sourceSegmentId: null,
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
  desktopMocks.listProjects.mockResolvedValue([project]);
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
      posterPath:
        "W:\\SiaoVPlay\\app-data\\media-cache\\project\\poster.jpg",
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
});

describe("App", () => {
  it("shows the approved local project library", async () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: "专注观看，需要时再理解。",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("雨站台")).toBeInTheDocument();
    expect(screen.getByText("本地媒体工具可用")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "导入本地视频" }),
    ).toBeEnabled();
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
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));

    expect(
      await screen.findByText("正在确认视频画面"),
    ).toBeInTheDocument();
    expect(desktopMocks.markProjectOpened).toHaveBeenCalledWith(project.id);
    expect(desktopMocks.prepareProjectMedia).toHaveBeenCalledWith(
      project.id,
      false,
    );
    expect(screen.getByText(/H264\s*\/ AAC/)).toBeInTheDocument();
  });

  it("opens the local import dialog with Ctrl+O", async () => {
    render(<App />);
    await screen.findByText("雨站台");

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });

    await waitFor(() => expect(desktopMocks.chooseLocalVideo).toHaveBeenCalled());
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

    fireEvent.click(
      await screen.findByRole("button", { name: "取消导入" }),
    );
    const operationId =
      desktopMocks.importRemoteMediaUrl.mock.calls[0][2];
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
    fireEvent.click(
      await screen.findByRole("button", { name: "添加字幕" }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /选择字幕文件/ }),
    );
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
    expect(await screen.findByText("时间轴和媒体范围检查通过，可以导入。"))
      .toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "导入原文字幕" }),
    );

    await waitFor(() =>
      expect(desktopMocks.importSubtitleFile).toHaveBeenCalled(),
    );
    expect(
      await screen.findByText("已导入 1 条原文字幕，保存为版本 1。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "原文字幕 · 1" }))
      .toBeInTheDocument();
  });

  it("starts and cancels local Japanese subtitle generation", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "继续观看" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "添加字幕" }),
    );
    fireEvent.click(
      screen.getByRole("tab", { name: "从视频生成" }),
    );

    expect(
      await screen.findByText("语音识别只在本机运行"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/视频原声语言/), {
      target: { value: "ja" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "生成原文字幕" }),
    );

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
    expect(screen.getByText("临时音频和识别文件已经清理。"))
      .toBeInTheDocument();
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
    fireEvent.click(
      await screen.findByRole("button", { name: "添加字幕" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /内嵌字幕轨 2/ }),
    );
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
});
