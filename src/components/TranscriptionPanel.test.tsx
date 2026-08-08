import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalResourceCatalog, LocalResourceStatus } from "../types";
import { TranscriptionPanel } from "./TranscriptionPanel";

const desktopMocks = vi.hoisted(() => ({
  cancelTranscriptionJob: vi.fn(),
  getTranscriptionJob: vi.fn(),
  getTranscriptionRuntimeStatus: vi.fn(),
  listSubtitleVersions: vi.fn(),
  listTranscriptionJobs: vi.fn(),
  resumeTranscriptionJob: vi.fn(),
  startTranscription: vi.fn(),
}));

vi.mock("../lib/desktop", () => ({
  ...desktopMocks,
  commandError: (error: unknown) => ({
    code: "test_error",
    message: error instanceof Error ? error.message : String(error),
  }),
}));

const catalog: LocalResourceCatalog = {
  schemaVersion: 1,
  productId: "siaovplay",
  updatedAt: "2026-08-08",
  packageProfile: "app-only",
  bundlePolicy: {
    maximumExceptionBytes: 20_000_000,
    allowlistedResourceIds: [],
  },
  capabilities: [],
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
      id: "whisper-model-base",
      version: "ggml-base",
      platform: "any",
      kind: "file",
      bundled: false,
      installedSize: 147_951_465,
      license: "MIT",
      sourcePage: "https://example.com/base",
      artifact: {
        url: "https://example.com/ggml-base.bin",
        size: 147_951_465,
        sha256: "a".repeat(64),
        format: "file",
      },
      entrypoints: {},
      healthCheck: "whisper-model-magic",
    },
    {
      id: "whisper-model-small",
      version: "ggml-small",
      platform: "any",
      kind: "file",
      bundled: false,
      installedSize: 487_601_967,
      license: "MIT",
      sourcePage: "https://example.com/small",
      artifact: {
        url: "https://example.com/ggml-small.bin",
        size: 487_601_967,
        sha256: "b".repeat(64),
        format: "file",
      },
      entrypoints: {},
      healthCheck: "whisper-model-magic",
    },
  ],
};

const status: LocalResourceStatus = {
  configured: true,
  selectedParent: "W:\\SiaoVPlay",
  resourceRoot: "W:\\SiaoVPlay\\LocalResources",
  rootState: "ready",
  freeSpaceBytes: 500_000_000_000,
  preferredProfile: "standard",
  capabilities: [
    {
      id: "local_transcription",
      title: "本地字幕识别",
      state: "not_ready",
      requiredResourceIds: ["whisper-cpu", "whisper-model-small"],
      missingResourceIds: ["whisper-cpu", "whisper-model-small"],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("TranscriptionPanel", () => {
  it("blocks generation until managed resources are ready and reports real model sizes", async () => {
    const onPrepareResources = vi.fn();
    render(
      <TranscriptionPanel
        projectId="00000000-0000-4000-8000-000000000001"
        currentVersion={null}
        onJobTracked={() => undefined}
        onVersionReady={() => undefined}
        localResourceCatalog={catalog}
        localResourceStatus={status}
        onPrepareResources={onPrepareResources}
      />,
    );

    expect(
      await screen.findByText("本地语音能力尚未就绪"),
    ).toBeInTheDocument();
    expect(screen.getByText(/识别模型下载 488 MB/)).toBeInTheDocument();
    expect(screen.getByText(/识别模型下载 148 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/轻量/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/视频原声语言/), {
      target: { value: "ja" },
    });
    expect(
      screen.getByRole("button", { name: "生成原文字幕" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /快速识别/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "准备本地字幕识别" }),
    );
    await waitFor(() => expect(onPrepareResources).toHaveBeenCalledWith("fast"));
    expect(desktopMocks.startTranscription).not.toHaveBeenCalled();
  });
});
