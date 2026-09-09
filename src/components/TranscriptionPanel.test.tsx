import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalResourceCatalog, LocalResourceStatus, TranscriptionJob } from "../types";
import { TranscriptionPanel } from "./TranscriptionPanel";

const desktopMocks = vi.hoisted(() => ({
  cancelTranscriptionJob: vi.fn(),
  getTranscriptionJob: vi.fn(),
  getTranscriptionRuntimeStatus: vi.fn(),
  getSubtitleVersion: vi.fn(),
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
      ...{ installedSize: null, expectedDownloadSize: null, artifact: null, entrypoints: {}, sourceCommit: null, patchSha256: null, requires: null, distribution: null },
      id: "whisper-model-base",
      version: "ggml-base",
      platform: "any",
      kind: "file",
      bundled: false,
      installedSize: 147_951_465,
      license: "MIT",
      sourcePage: "https://example.com/base",
      artifact: {
        stripComponents: null,
        url: "https://example.com/ggml-base.bin",
        size: 147_951_465,
        sha256: "a".repeat(64),
        format: "file",
      },
      entrypoints: {},
      healthCheck: "whisper-model-magic",
    },
    {
      ...{ installedSize: null, expectedDownloadSize: null, artifact: null, entrypoints: {}, sourceCommit: null, patchSha256: null, requires: null, distribution: null },
      id: "whisper-model-small",
      version: "ggml-small",
      platform: "any",
      kind: "file",
      bundled: false,
      installedSize: 487_601_967,
      license: "MIT",
      sourcePage: "https://example.com/small",
      artifact: {
        stripComponents: null,
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
  snapshotRevision: 1,
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

const savedJob: TranscriptionJob = { id: "job", projectId: "project", status: "transcribing", stage: "transcribing", progress: 0.4, languageCode: "en", modelKind: "small", runtimeBackend: "cpu", runtimeVersion: "1", subtitleVersionId: null, errorCode: null, errorMessage: null, createdAtMs: 1, updatedAtMs: 1, startedAtMs: 1, completedAtMs: null };
const props = { projectId: "project", currentVersion: null, onJobTracked: vi.fn(), onVersionReady: vi.fn() };
it("keeps a saved task visible when runtime detection fails", async () => {
  desktopMocks.getTranscriptionRuntimeStatus.mockRejectedValue(new Error("检测暂时失败"));
  desktopMocks.listTranscriptionJobs.mockResolvedValue([savedJob]);
  render(<TranscriptionPanel {...props} />);
  expect(await screen.findByText("正在识别语音")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "取消生成" })).toBeEnabled();
  expect(await screen.findByRole("button", { name: "重新检查" })).toBeEnabled();
});
it("blocks duplicate generation until task history can be read again", async () => {
  desktopMocks.listTranscriptionJobs.mockRejectedValueOnce(new Error("任务记录暂时不可读")).mockResolvedValue([]);
  render(<TranscriptionPanel {...props} />);
  expect(await screen.findByText("任务记录暂时不可读")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/视频原声语言/), { target: { value: "ja" } });
  expect(screen.getByRole("button", { name: "生成原文字幕" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "生成原文字幕" })).toBeEnabled());
  expect(screen.getByLabelText(/视频原声语言/)).toHaveValue("ja");
  expect(desktopMocks.startTranscription).not.toHaveBeenCalled();
  expect(screen.queryByText("任务记录暂时不可读")).not.toBeInTheDocument();
});
it("shows a saved task while a runtime check is still pending", async () => {
  desktopMocks.getTranscriptionRuntimeStatus.mockReturnValue(new Promise(() => {}));
  desktopMocks.listTranscriptionJobs.mockResolvedValue([savedJob]);
  render(<TranscriptionPanel {...props} />);
  expect(await screen.findByText("正在识别语音")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "取消生成" })).toBeEnabled();
});

it("does not expose or restore another project's job after switching", async () => {
  let finishOld!: (value: TranscriptionJob[]) => void;
  desktopMocks.listTranscriptionJobs.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValue([]);
  const { rerender } = render(<TranscriptionPanel {...props} />);
  rerender(<TranscriptionPanel {...props} projectId="other" />);
  await act(async () => finishOld([savedJob]));
  expect(await screen.findByRole("button", { name: "生成原文字幕" })).toBeInTheDocument();
  expect(screen.queryByText("正在识别语音")).not.toBeInTheDocument();
});
it("hides the previous project's existing task immediately on switching", async () => {
  desktopMocks.listTranscriptionJobs.mockResolvedValueOnce([savedJob]).mockReturnValue(new Promise(() => {}));
  const { rerender } = render(<TranscriptionPanel {...props} />);
  expect(await screen.findByText("正在识别语音")).toBeInTheDocument();
  rerender(<TranscriptionPanel {...props} projectId="other" />);
  expect(screen.queryByRole("button", { name: "取消生成" })).not.toBeInTheDocument();
});

it("retries a failed task read and clears only its recovered polling error", async () => {
  desktopMocks.listTranscriptionJobs.mockResolvedValue([savedJob]);
  desktopMocks.getTranscriptionJob.mockRejectedValueOnce(new Error("状态读取暂时失败")).mockResolvedValue({ ...savedJob, progress: 0.6 });
  render(<TranscriptionPanel {...props} />);
  expect(await screen.findByText("状态读取暂时失败", {}, { timeout: 2500 })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60"), { timeout: 2500 });
  expect(screen.queryByText("状态读取暂时失败")).not.toBeInTheDocument();
});
it.each(["cancelled", "transcribing"] as const)("preserves %s cancellation against a batched transcription poll", async (status) => {
  desktopMocks.listTranscriptionJobs.mockResolvedValue([savedJob]);
  let finishPoll!: (value: TranscriptionJob) => void;
  let finishCancel!: (value: TranscriptionJob) => void;
  desktopMocks.getTranscriptionJob.mockImplementation(() => new Promise(resolve => { finishPoll = resolve; }));
  desktopMocks.cancelTranscriptionJob.mockImplementation(() => new Promise(resolve => { finishCancel = resolve; }));
  render(<TranscriptionPanel {...props} />);
  await waitFor(() => expect(finishPoll).toBeTypeOf("function"), { timeout: 2500 });
  fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
  await act(async () => {
    finishCancel({ ...savedJob, status, stage: status === "cancelled" ? "cancelled" : "cancelling" });
    await Promise.resolve(); finishPoll(savedJob); await Promise.resolve();
  });
  expect(screen.queryByRole("button", { name: "取消生成" })).not.toBeInTheDocument();
  if (status === "cancelled") expect(screen.getByRole("button", { name: "重新开始" })).toBeInTheDocument();
  else expect(screen.getByRole("button", { name: "正在停止…" })).toBeDisabled();
});

it("does not hide a cancellation failure when polling succeeds", async () => {
  desktopMocks.listTranscriptionJobs.mockResolvedValue([savedJob]);
  desktopMocks.getTranscriptionJob.mockResolvedValue({ ...savedJob, progress: 0.6 });
  desktopMocks.cancelTranscriptionJob.mockRejectedValue(new Error("取消请求失败"));
  render(<TranscriptionPanel {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "取消生成" }));
  expect(await screen.findByText("取消请求失败")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60"), { timeout: 2500 });
  expect(screen.getByText("取消请求失败")).toBeInTheDocument();
});
