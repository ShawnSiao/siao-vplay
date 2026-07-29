import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaPreparation, Project } from "./types";

const desktopMocks = vi.hoisted(() => ({
  getAppStatus: vi.fn(),
  getMediaRuntimeStatus: vi.fn(),
  listProjects: vi.fn(),
  chooseLocalVideo: vi.fn(),
  createLocalProject: vi.fn(),
  markProjectOpened: vi.fn(),
  prepareProjectMedia: vi.fn(),
  updatePlaybackState: vi.fn(),
  relinkProjectMedia: vi.fn(),
  deleteProject: vi.fn(),
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
    displayName: "rain-platform.mp4",
    isAvailable: true,
    sourceSha256: null,
    probedAtMs: null,
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
  },
  playbackSourceKind: "original",
  playbackPath: project.mediaSource.locator,
  proxyArtifact: null,
  reusedProxy: false,
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
  desktopMocks.createLocalProject.mockResolvedValue(project);
  desktopMocks.markProjectOpened.mockResolvedValue(project);
  desktopMocks.prepareProjectMedia.mockResolvedValue(preparation);
  desktopMocks.updatePlaybackState.mockResolvedValue(project);
  desktopMocks.deleteProject.mockResolvedValue({
    projectId: project.id,
    deleted: true,
    sourceMediaDeleted: false,
  });
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
});
