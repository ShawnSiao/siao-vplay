import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LocalResourcesController } from "../features/resources/useLocalResources";
import type {
  LocalResourceCatalog,
  LocalResourceStatus,
  ResourceDownloadTask,
} from "../types";
import { LocalResourcesDialog } from "./LocalResourcesDialog";

const catalog: LocalResourceCatalog = {
  schemaVersion: 1,
  productId: "siaovplay",
  updatedAt: "2026-08-08",
  packageProfile: "app-only",
  bundlePolicy: {
    maximumExceptionBytes: 20_000_000,
    allowlistedResourceIds: [],
  },
  capabilities: [
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
  ],
  profiles: [],
  resources: [
    {
      id: "ffmpeg-cpu",
      version: "8.1",
      platform: "windows-x86_64",
      kind: "archive",
      bundled: false,
      installedSize: 175_926_890,
      license: "LGPL-2.1-or-later",
      sourcePage: "https://example.com/ffmpeg",
      artifact: {
        url: "https://example.com/ffmpeg.zip",
        size: 70_510_962,
        sha256: "a".repeat(64),
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
      sourcePage: "https://example.com/yt-dlp",
      artifact: {
        url: "https://example.com/yt-dlp.exe",
        size: 18_202_192,
        sha256: "b".repeat(64),
        format: "file",
      },
      entrypoints: {},
      healthCheck: "yt-dlp-version",
    },
  ],
};

const setupStatus: LocalResourceStatus = {
  configured: false,
  selectedParent: null,
  resourceRoot: null,
  rootState: "setup_required",
  freeSpaceBytes: null,
  preferredProfile: "standard",
  capabilities: [
    {
      id: "basic_media",
      title: "基础视频支持",
      state: "setup_required",
      requiredResourceIds: ["ffmpeg-cpu"],
      missingResourceIds: ["ffmpeg-cpu"],
    },
    {
      id: "url_import",
      title: "在线视频导入",
      state: "setup_required",
      requiredResourceIds: ["ffmpeg-cpu", "yt-dlp"],
      missingResourceIds: ["ffmpeg-cpu", "yt-dlp"],
    },
  ],
};

function makeController(
  overrides: Partial<LocalResourcesController> = {},
): LocalResourcesController {
  return {
    catalog,
    status: setupStatus,
    tasks: [],
    taskMetrics: {},
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(setupStatus),
    clearError: vi.fn(),
    chooseLocation: vi.fn().mockResolvedValue({
      selectedParent: "W:\\SiaoVPlay",
      resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
      parentExists: true,
      resourceRootExists: false,
      freeSpaceBytes: 500_000_000_000,
      confirmationRequired: true,
    }),
    confirmLocation: vi.fn().mockResolvedValue({
      ...setupStatus,
      configured: true,
      resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
      rootState: "ready",
    }),
    inspectLegacyResources: vi.fn().mockResolvedValue({
      sources: [],
      candidates: [],
      verifiedResourceIds: [],
      reusableBytes: 0,
      rejectedCount: 0,
    }),
    chooseExistingResources: vi.fn().mockResolvedValue(null),
    adoptResources: vi.fn().mockResolvedValue({
      adoptedResourceIds: [],
      alreadyActiveResourceIds: [],
      rejectedResourceIds: [],
      reusableBytes: 0,
    }),
    chooseMoveLocation: vi.fn().mockResolvedValue(null),
    moveLocation: vi.fn(),
    repairRoot: vi.fn(),
    reconnectRoot: vi.fn().mockResolvedValue(null),
    planCleanup: vi.fn().mockResolvedValue({
      resourceIds: [],
      reclaimableBytes: 0,
      confirmationRequired: true,
    }),
    cleanupUnused: vi.fn().mockResolvedValue({
      removedResourceIds: [],
      reclaimedBytes: 0,
    }),
    selectProfile: vi.fn().mockResolvedValue(setupStatus),
    prepareCapability: vi.fn().mockResolvedValue({
      capabilityId: "basic_media",
      pendingActionId: null,
      state: "preparing",
      resourceIds: ["ffmpeg-cpu"],
      readyResourceIds: [],
      taskIds: ["00000000-0000-4000-8000-000000000001"],
    }),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    cancelTask: vi.fn(),
    retryTask: vi.fn(),
    repairResource: vi.fn(),
    removeResource: vi.fn(),
    ...overrides,
  };
}

describe("LocalResourcesDialog", () => {
  it("offers the three first-run choices without exposing technical details", () => {
    const onDismissFirstRun = vi.fn();
    render(
      <LocalResourcesDialog
        controller={makeController()}
        firstRun
        pendingAction={null}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={onDismissFirstRun}
        onNotice={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: /使用推荐配置/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /选择需要的功能/ }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /稍后设置/ }));
    expect(onDismissFirstRun).toHaveBeenCalledOnce();
    expect(screen.getByText("ffmpeg-cpu")).not.toBeVisible();
    expect(screen.getAllByText(/SHA-256/)[0]).not.toBeVisible();
  });

  it("shows exact location and size estimates before explicit confirmation", async () => {
    const controller = makeController();
    render(
      <LocalResourcesDialog
        controller={controller}
        firstRun
        pendingAction={null}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /使用推荐配置/ }));
    expect(screen.getByText("88.7 MB")).toBeInTheDocument();
    expect(screen.getByText("194 MB")).toBeInTheDocument();
    expect(controller.prepareCapability).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "选择位置" }));
    expect(
      await screen.findByText("W:\\SiaoVPlay\\SiaoVPlay"),
    ).toBeInTheDocument();
    expect(screen.getByText("下载尚未开始")).toBeInTheDocument();
    expect(controller.confirmLocation).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "确认位置并开始准备" }),
    );
    await waitFor(() =>
      expect(controller.confirmLocation).toHaveBeenCalledWith(
        "W:\\SiaoVPlay",
      ),
    );
    expect(controller.prepareCapability).toHaveBeenCalledWith(
      "basic_media",
      undefined,
    );
    expect(controller.prepareCapability).toHaveBeenCalledWith(
      "url_import",
      undefined,
    );
  });

  it("associates a pending action and exposes task controls with accessible progress", async () => {
    const task: ResourceDownloadTask = {
      id: "00000000-0000-4000-8000-000000000001",
      resourceId: "yt-dlp",
      version: "2026.06.09",
      state: "downloading",
      downloadedBytes: 9_101_096,
      totalBytes: 18_202_192,
      requestedByCapabilityIds: ["url_import"],
      pendingActionIds: ["00000000-0000-4000-8000-000000000099"],
      attempt: 1,
      errorCode: null,
      errorMessage: null,
      createdAtMs: 1,
      updatedAtMs: 2,
      forceReinstall: false,
    };
    const pauseTask = vi.fn().mockResolvedValue({ ...task, state: "paused" });
    const controller = makeController({
      status: {
        ...setupStatus,
        configured: true,
        resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
        rootState: "ready",
        capabilities: setupStatus.capabilities.map((capability) => ({
          ...capability,
          state: capability.id === "basic_media" ? "ready" : "preparing",
          missingResourceIds:
            capability.id === "basic_media" ? [] : ["yt-dlp"],
        })),
      },
      tasks: [task],
      taskMetrics: {
        [task.id]: { bytesPerSecond: 2_000_000, remainingSeconds: 4.6 },
      },
      pauseTask,
    });
    render(
      <LocalResourcesDialog
        controller={controller}
        firstRun={false}
        pendingAction={{
          id: "00000000-0000-4000-8000-000000000099",
          capabilityId: "url_import",
          label: "继续打开在线视频",
        }}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />,
    );

    expect(screen.getByText("继续打开在线视频")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "正在准备所选功能" }),
    ).toBeDisabled();
    const progress = screen.getByRole("progressbar", {
      name: "在线视频导入准备进度",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText(/2.0 MB\/秒/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    await waitFor(() => expect(pauseTask).toHaveBeenCalledWith(task.id));
  });

  it("supports verified adoption, copy-before-switch moves, and unavailable-root recovery", async () => {
    const readyStatus: LocalResourceStatus = {
      ...setupStatus,
      configured: true,
      selectedParent: "W:\\SiaoVPlay",
      resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
      rootState: "ready",
    };
    const inspectLegacyResources = vi.fn().mockResolvedValue({
      sources: [{ kind: "legacy_settings", path: "W:\\Legacy" }],
      candidates: [
        {
          sourceKind: "legacy_settings",
          sourceRoot: "W:\\Legacy",
          resourceId: "yt-dlp",
          resourcePath: "W:\\Legacy\\yt-dlp.exe",
          state: "verified",
          reusableBytes: 18_202_192,
          message: null,
        },
      ],
      verifiedResourceIds: ["yt-dlp"],
      reusableBytes: 18_202_192,
      rejectedCount: 0,
    });
    const adoptResources = vi.fn().mockResolvedValue({
      adoptedResourceIds: ["yt-dlp"],
      alreadyActiveResourceIds: [],
      rejectedResourceIds: [],
      reusableBytes: 18_202_192,
    });
    const chooseMoveLocation = vi.fn().mockResolvedValue({
      previousRoot: "W:\\SiaoVPlay\\SiaoVPlay",
      selectedParent: "E:\\Resources",
      resourceRoot: "E:\\Resources\\SiaoVPlay",
      bytesToCopy: 194_129_082,
      fileCount: 12,
      freeSpaceBytes: 500_000_000_000,
      crossVolume: true,
      destinationExists: false,
      confirmationRequired: true,
    });
    const moveLocation = vi.fn().mockResolvedValue({
      previousRoot: "W:\\SiaoVPlay\\SiaoVPlay",
      currentRoot: "E:\\Resources\\SiaoVPlay",
      copiedBytes: 194_129_082,
      verifiedFileCount: 12,
      crossVolume: true,
      previousRootRetained: true,
    });
    const controller = makeController({
      status: readyStatus,
      inspectLegacyResources,
      adoptResources,
      chooseMoveLocation,
      moveLocation,
    });
    render(
      <LocalResourcesDialog
        controller={controller}
        firstRun={false}
        pendingAction={null}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "检查旧版资源" }));
    expect(await screen.findByText("发现 1 项可复用资源")).toBeInTheDocument();
    expect(screen.getByText(/不会读取 Component Store 数据库或租约/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "接管已验证资源" }));
    await waitFor(() => expect(adoptResources).toHaveBeenCalledWith(undefined));

    fireEvent.click(screen.getByRole("button", { name: "移动保存位置" }));
    expect(await screen.findByText("E:\\Resources\\SiaoVPlay")).toBeInTheDocument();
    expect(screen.getByText(/切换成功后原目录仍保留/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认复制并切换" }));
    await waitFor(() => expect(moveLocation).toHaveBeenCalledWith("E:\\Resources"));
  });

  it("keeps records when the resource disk is unavailable and offers repair or reconnect", async () => {
    const repairRoot = vi.fn();
    const reconnectRoot = vi.fn();
    render(
      <LocalResourcesDialog
        controller={makeController({
          status: {
            ...setupStatus,
            configured: true,
            resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
            rootState: "root_unavailable",
          },
          repairRoot,
          reconnectRoot,
        })}
        firstRun={false}
        pendingAction={null}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />,
    );

    expect(screen.getByText("原资源位置当前不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新连接目录" }));
    await waitFor(() => expect(reconnectRoot).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "在原位置修复" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "在原位置修复" }));
    await waitFor(() => expect(repairRoot).toHaveBeenCalledOnce());
  });

  it("shows real transcription profile sizes and keeps unpublished runtimes disabled", async () => {
    const transcriptionCatalog: LocalResourceCatalog = {
      ...catalog,
      capabilities: [
        ...catalog.capabilities,
        {
          id: "local_transcription",
          title: "本地字幕识别",
          resourceIds: ["ffmpeg-cpu", "whisper-cpu", "whisper-vad-silero-6.2"],
          profileIds: ["fast", "standard"],
          requiresCapabilityIds: [],
        },
      ],
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
        ...catalog.resources,
        {
          id: "whisper-cpu",
          version: "1.9.1-siaocut.1",
          platform: "windows-x86_64",
          kind: "archive",
          bundled: false,
          installedSize: 9_751_754,
          expectedDownloadSize: 3_594_453,
          license: "MIT",
          sourcePage: "https://example.com/whisper-cpu",
          distribution: { status: "pending_release_asset" },
          entrypoints: {},
          healthCheck: "whisper-runtime-metadata-and-timeline",
        },
        {
          id: "whisper-vad-silero-6.2",
          version: "6.2.0",
          platform: "any",
          kind: "file",
          bundled: false,
          installedSize: 864_680,
          license: "MIT",
          sourcePage: "https://example.com/vad",
          artifact: {
            url: "https://example.com/ggml-silero-v6.2.0.bin",
            size: 864_680,
            sha256: "e".repeat(64),
            format: "file",
          },
          entrypoints: {},
          healthCheck: "whisper-vad-magic",
        },
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
            sha256: "c".repeat(64),
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
            sha256: "d".repeat(64),
            format: "file",
          },
          entrypoints: {},
          healthCheck: "whisper-model-magic",
        },
      ],
    };
    const transcriptionStatus: LocalResourceStatus = {
      ...setupStatus,
      configured: true,
      resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
      rootState: "ready",
      capabilities: [
        ...setupStatus.capabilities,
        {
          id: "local_transcription",
          title: "本地字幕识别",
          state: "not_ready",
          requiredResourceIds: [
            "ffmpeg-cpu",
            "whisper-cpu",
            "whisper-vad-silero-6.2",
            "whisper-model-small",
          ],
          missingResourceIds: [
            "whisper-cpu",
            "whisper-vad-silero-6.2",
            "whisper-model-small",
          ],
        },
      ],
    };
    const selectProfile = vi.fn().mockResolvedValue(transcriptionStatus);
    render(
      <LocalResourcesDialog
        controller={makeController({
          catalog: transcriptionCatalog,
          status: transcriptionStatus,
          selectProfile,
        })}
        firstRun={false}
        pendingAction={{
          id: "00000000-0000-4000-8000-000000000199",
          capabilityId: "local_transcription",
          label: "继续生成原文字幕",
          profileId: "standard",
        }}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />,
    );

    expect(screen.getByText(/直接展示真实大小/)).toBeInTheDocument();
    expect(screen.queryByText(/轻量/)).not.toBeInTheDocument();
    expect(screen.getByText(/识别模型下载 488 MB/)).toBeInTheDocument();
    expect(screen.getByText(/识别模型下载 148 MB/)).toBeInTheDocument();
    expect(screen.getByText("当前不能开始下载")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "当前不能开始准备" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /快速/ }));
    await waitFor(() => expect(selectProfile).toHaveBeenCalledWith("fast"));
  });

  it("keeps versions, hashes, sources, and repair actions inside advanced diagnostics", () => {
    const readyStatus: LocalResourceStatus = {
      ...setupStatus,
      configured: true,
      resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
      rootState: "ready",
      capabilities: setupStatus.capabilities.map((capability) => ({
        ...capability,
        state: "ready",
        missingResourceIds: [],
      })),
    };
    render(
      <LocalResourcesDialog
        controller={makeController({ status: readyStatus })}
        firstRun={false}
        pendingAction={null}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />,
    );

    const details = screen.getByText("高级诊断与第三方许可").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("ffmpeg-cpu")).not.toBeVisible();
    expect(screen.getAllByText(/SHA-256/)[0]).not.toBeVisible();
    fireEvent.click(within(details as HTMLElement).getByText("高级诊断与第三方许可"));
    expect(screen.getByText("ffmpeg-cpu")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "修复 ffmpeg-cpu" }),
    ).toBeVisible();
  });
});
