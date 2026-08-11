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
    networkStatus: {
      mode: "proxy",
      proxySource: "windows_system",
      proxyAddress: "http://127.0.0.1:7897",
    },
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
    loadDiagnostics: vi.fn().mockResolvedValue({
      diagnostics: {
        generatedAtMs: 1,
        catalogSource: "embedded",
        remoteCatalogEnabled: false,
        remoteSignaturePolicy: "ed25519-detached-v1-required-before-enable",
        rootState: "ready",
        resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
        preferredProfile: "standard",
        resources: [],
        tasks: [],
      },
      thirdPartyNotices: "# 第三方许可说明",
    }),
    diagnosticSummary: vi.fn().mockResolvedValue("脱敏诊断摘要"),
    updateResource: vi.fn(),
    rollbackResource: vi.fn(),
    planOldVersionCleanup: vi.fn().mockResolvedValue({
      candidates: [],
      protectedVersions: [],
      reclaimableBytes: 0,
      confirmationRequired: true,
    }),
    cleanupOldVersions: vi.fn().mockResolvedValue({
      removedVersions: [],
      reclaimedBytes: 0,
    }),
    selectProfile: vi.fn().mockResolvedValue(setupStatus),
    setProxy: vi.fn().mockResolvedValue({
      mode: "proxy",
      proxySource: "custom",
      proxyAddress: "http://127.0.0.1:7897",
    }),
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
  it("keeps first run limited to an optional save location", () => {
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

    expect(screen.getByRole("heading", { name: "选择本地功能的保存位置" })).toBeVisible();
    expect(screen.getByRole("button", { name: "选择保存位置" })).toBeEnabled();
    expect(screen.queryByText("基础视频支持")).not.toBeInTheDocument();
    expect(screen.getByText(/此步骤不会下载依赖包或模型/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /稍后设置/ }));
    expect(onDismissFirstRun).toHaveBeenCalledOnce();
    expect(screen.getByText("ffmpeg-cpu")).not.toBeVisible();
    expect(screen.getAllByText(/SHA-256/)[0]).not.toBeVisible();
  });

  it("saves the first-run location without downloading dependencies", async () => {
    const controller = makeController();
    const onDismissFirstRun = vi.fn();
    render(
      <LocalResourcesDialog
        controller={controller}
        firstRun
        pendingAction={null}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={onDismissFirstRun}
        onNotice={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择保存位置" }));
    expect(
      await screen.findByText("W:\\SiaoVPlay\\SiaoVPlay"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 B")).toBeInTheDocument();
    expect(controller.confirmLocation).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "保存位置并进入" }),
    );
    await waitFor(() =>
      expect(controller.confirmLocation).toHaveBeenCalledWith(
        "W:\\SiaoVPlay",
      ),
    );
    expect(controller.prepareCapability).not.toHaveBeenCalled();
    expect(onDismissFirstRun).toHaveBeenCalledOnce();
  });

  it("shows directory selection errors before the scrollable setup content", async () => {
    const chooseLocation = vi.fn().mockRejectedValue(new Error("无法打开目录选择器"));
    render(
      <LocalResourcesDialog
        controller={makeController({ chooseLocation })}
        firstRun={false}
        pendingAction={null}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择保存位置" }));
    const alert = await screen.findByRole("alert");
    const locationHeading = screen.getByRole("heading", { name: "保存位置" });
    expect(alert).toHaveTextContent("无法打开目录选择器");
    expect(
      alert.compareDocumentPosition(locationHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    const chooseExistingResources = vi.fn().mockResolvedValue({
      sourcePath: "W:\\LegacySiaoVPlay",
      preview: {
        sources: [{ kind: "selected_directory", path: "W:\\LegacySiaoVPlay" }],
        candidates: [
          {
            sourceKind: "selected_directory",
            sourceRoot: "W:\\LegacySiaoVPlay",
            resourceId: "yt-dlp",
            resourcePath: "W:\\LegacySiaoVPlay\\yt-dlp.exe",
            state: "verified",
            reusableBytes: 18_202_192,
            message: null,
          },
        ],
        verifiedResourceIds: ["yt-dlp"],
        reusableBytes: 18_202_192,
        rejectedCount: 0,
      },
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
      chooseExistingResources,
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

    fireEvent.click(screen.getByRole("button", { name: "选择现有资源目录" }));
    expect(await screen.findByText("发现 1 项可复用资源")).toBeInTheDocument();
    expect(screen.getByText(/只检查了明确选择的目录/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "接管已验证资源" }));
    await waitFor(() =>
      expect(adoptResources).toHaveBeenCalledWith("W:\\LegacySiaoVPlay"),
    );

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

  it("shows light and standard transcription sizes with a downloadable CPU runtime", async () => {
    const transcriptionCatalog: LocalResourceCatalog = {
      ...catalog,
      capabilities: [
        ...catalog.capabilities,
        {
          id: "local_transcription",
          title: "本地字幕识别",
          resourceIds: ["ffmpeg-cpu", "whisper-cpu"],
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
          version: "1.9.1",
          platform: "windows-x86_64",
          kind: "archive",
          bundled: false,
          installedSize: 20_355_072,
          license: "MIT",
          sourcePage: "https://example.com/whisper-cpu",
          artifact: {
            url: "https://example.com/whisper-bin-x64.zip",
            size: 7_982_101,
            sha256: "f".repeat(64),
            format: "zip",
          },
          entrypoints: {},
          healthCheck: "whisper-cli-version",
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
            "whisper-model-small",
          ],
          missingResourceIds: [
            "whisper-cpu",
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
    expect(screen.getByRole("radio", { name: /轻量/ })).toBeEnabled();
    expect(screen.getByText(/识别模型下载 488 MB/)).toBeInTheDocument();
    expect(screen.getByText(/识别模型下载 148 MB/)).toBeInTheDocument();
    expect(screen.getByText(/需下载 496 MB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始准备所选功能" })).toBeEnabled();

    fireEvent.click(screen.getByRole("radio", { name: /轻量/ }));
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
    expect(screen.getAllByRole("img", { name: "已准备" })).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: /选择准备/ })).toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("ffmpeg-cpu")).not.toBeVisible();
    expect(screen.getAllByText(/SHA-256/)[0]).not.toBeVisible();
    fireEvent.click(within(details as HTMLElement).getByText("高级诊断与第三方许可"));
    expect(screen.getByText("ffmpeg-cpu")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "修复 ffmpeg-cpu" }),
    ).toBeVisible();
  });

  it("shows Windows proxy status and allows a simple custom override", async () => {
    const readyStatus: LocalResourceStatus = {
      ...setupStatus,
      configured: true,
      resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
      rootState: "ready",
    };
    const setProxy = vi.fn().mockResolvedValue({
      mode: "proxy",
      proxySource: "custom",
      proxyAddress: "http://127.0.0.1:8899",
    });
    render(
      <LocalResourcesDialog
        controller={makeController({ status: readyStatus, setProxy })}
        firstRun={false}
        pendingAction={null}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />,
    );

    fireEvent.click(screen.getByText("高级诊断与第三方许可"));
    expect(screen.getByText("跟随 Windows 系统代理")).toBeVisible();
    fireEvent.change(screen.getByLabelText("指定 HTTP(S) 代理（可选）"), {
      target: { value: "http://127.0.0.1:8899" },
    });
    fireEvent.click(screen.getByRole("button", { name: "使用指定代理" }));
    await waitFor(() =>
      expect(setProxy).toHaveBeenCalledWith("http://127.0.0.1:8899"),
    );
  });

  it("loads version history, supports safe update and rollback, and copies a redacted summary", async () => {
    const readyStatus: LocalResourceStatus = {
      ...setupStatus,
      configured: true,
      resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
      rootState: "ready",
      capabilities: setupStatus.capabilities.map((capability) => ({
        ...capability,
        state: capability.id === "url_import" ? "update_available" : "ready",
        missingResourceIds: [],
      })),
    };
    const loadDiagnostics = vi.fn().mockResolvedValue({
      diagnostics: {
        generatedAtMs: 1,
        catalogSource: "embedded",
        remoteCatalogEnabled: false,
        remoteSignaturePolicy: "ed25519-detached-v1-required-before-enable",
        rootState: "ready",
        resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
        preferredProfile: "standard",
        resources: [
          {
            id: "yt-dlp",
            catalogVersion: "2026.06.09",
            activeVersion: "2026.05.01",
            state: "update_available",
            license: "GPL-3.0-or-later",
            sourcePage: "https://example.com/yt-dlp",
            artifactSha256: "b".repeat(64),
            artifactUrl: "https://example.com/yt-dlp.exe",
            healthCheck: "yt-dlp-version",
            versions: [
              {
                version: "2026.05.01",
                active: true,
                installPath: "W:\\SiaoVPlay\\packages\\yt-dlp\\2026.05.01",
                fileCount: 1,
                installedBytes: 18_000_000,
                manifestSha256: "c".repeat(64),
                healthStatus: "passed",
                activatedAtMs: 2,
                entrypointsAvailable: true,
              },
              {
                version: "2026.04.01",
                active: false,
                installPath: "W:\\SiaoVPlay\\packages\\yt-dlp\\2026.04.01",
                fileCount: 1,
                installedBytes: 17_000_000,
                manifestSha256: "d".repeat(64),
                healthStatus: "passed",
                activatedAtMs: 1,
                entrypointsAvailable: true,
              },
            ],
          },
        ],
        tasks: [],
      },
      thirdPartyNotices: "# 第三方许可说明\n\n本安装包不包含可选资源。",
    });
    const updateResource = vi.fn().mockResolvedValue({});
    const rollbackResource = vi.fn().mockResolvedValue({
      resourceId: "yt-dlp",
      previousVersion: "2026.05.01",
      activeVersion: "2026.04.01",
    });
    const diagnosticSummary = vi.fn().mockResolvedValue("不含 token 的脱敏摘要");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <LocalResourcesDialog
        controller={makeController({
          status: readyStatus,
          loadDiagnostics,
          updateResource,
          rollbackResource,
          diagnosticSummary,
        })}
        firstRun={false}
        pendingAction={null}
        previewMode={false}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />,
    );

    fireEvent.click(screen.getByText("高级诊断与第三方许可"));
    expect(await screen.findByText("当前使用内置可信目录清单")).toBeVisible();
    expect(screen.getByText("2026.05.01（活动）")).toBeVisible();
    expect(screen.getByText("2026.04.01")).toBeVisible();
    expect(screen.getByText(/路径 W:\\SiaoVPlay.*2026\.05\.01/)).toBeVisible();
    expect(screen.getAllByText(/健康检查 passed/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "回退到 2026.04.01" }));
    await waitFor(() =>
      expect(rollbackResource).toHaveBeenCalledWith("yt-dlp", "2026.04.01"),
    );
    fireEvent.click(screen.getByRole("button", { name: "复制脱敏诊断摘要" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("不含 token 的脱敏摘要"));
    fireEvent.click(screen.getByText("查看完整第三方许可说明"));
    expect(screen.getByText(/本安装包不包含可选资源/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "更新 yt-dlp" }));
    await waitFor(() => expect(updateResource).toHaveBeenCalledWith("yt-dlp"));
  });
});
