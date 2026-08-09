import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import type { LocalResourcesController } from "../features/resources/useLocalResources";
import { RuntimeView } from "./RuntimeView";
import type {
  LocalResourceCatalog,
  LocalResourceStatus,
  ResourceDownloadTask,
} from "../types";
import "../styles.css";

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
    {
      id: "whisper-cpu",
      version: "1.9.1",
      platform: "windows-x86_64",
      kind: "archive",
      bundled: false,
      installedSize: 20_355_072,
      license: "MIT",
      sourcePage: "https://example.com/recognition-runtime",
      artifact: {
        url: "https://example.com/whisper-bin-x64.zip",
        size: 7_982_101,
        sha256: "f".repeat(64),
        format: "zip",
        stripComponents: 1,
      },
      entrypoints: { whisperCli: "whisper-cli.exe" },
      healthCheck: "whisper-cli-version",
    },
    {
      id: "whisper-model-base",
      version: "base",
      platform: "all",
      kind: "model",
      bundled: false,
      installedSize: 147_951_465,
      license: "MIT",
      sourcePage: "https://example.com/recognition-model-base",
      artifact: {
        url: "https://example.com/base.bin",
        size: 147_951_465,
        sha256: "e".repeat(64),
        format: "file",
      },
      entrypoints: { model: "base.bin" },
      healthCheck: "sha256",
    },
    {
      id: "whisper-model-small",
      version: "small",
      platform: "all",
      kind: "model",
      bundled: false,
      installedSize: 487_601_967,
      license: "MIT",
      sourcePage: "https://example.com/recognition-model",
      artifact: {
        url: "https://example.com/model.bin",
        size: 487_601_967,
        sha256: "c".repeat(64),
        format: "file",
      },
      entrypoints: {},
      healthCheck: "sha256",
    },
  ],
};

const status: LocalResourceStatus = {
  configured: true,
  selectedParent: "W:\\SiaoVPlay",
  resourceRoot: "W:\\SiaoVPlay\\LocalResources",
  rootState: "ready",
  freeSpaceBytes: 450_000_000_000,
  preferredProfile: "standard",
  capabilities: [
    {
      id: "basic_media",
      title: "基础视频支持",
      state: "ready",
      requiredResourceIds: ["ffmpeg-cpu"],
      missingResourceIds: [],
    },
    {
      id: "url_import",
      title: "在线视频导入",
      state: "preparing",
      requiredResourceIds: ["ffmpeg-cpu", "yt-dlp"],
      missingResourceIds: ["yt-dlp"],
    },
    {
      id: "local_transcription",
      title: "本地字幕识别",
      state: "not_ready",
      requiredResourceIds: [
        "ffmpeg-cpu",
        "whisper-cpu",
        "whisper-model-small",
      ],
      missingResourceIds: ["whisper-cpu", "whisper-model-small"],
    },
  ],
};

const initialTask: ResourceDownloadTask = {
  id: "00000000-0000-4000-8000-000000000001",
  resourceId: "yt-dlp",
  version: "2026.06.09",
  state: "paused",
  downloadedBytes: 9_101_096,
  totalBytes: 18_202_192,
  requestedByCapabilityIds: ["url_import"],
  pendingActionIds: [],
  attempt: 1,
  errorCode: "pause_requested",
  errorMessage: "下载已暂停",
  createdAtMs: 1,
  updatedAtMs: 2,
  forceReinstall: false,
};

export function RuntimeHarness() {
  const [tasks, setTasks] = useState([initialTask]);
  const controller = useMemo<LocalResourcesController>(
    () => ({
      catalog,
      status,
      tasks,
      taskMetrics: {
        [initialTask.id]: { bytesPerSecond: 0, remainingSeconds: null },
      },
      networkStatus: {
        mode: "proxy",
        proxySource: "windows_system",
        proxyAddress: "http://127.0.0.1:7897",
      },
      loading: false,
      error: null,
      refresh: async () => status,
      clearError: () => undefined,
      chooseLocation: async () => null,
      confirmLocation: async () => status,
      chooseExistingResources: async () => null,
      adoptResources: async () => ({
        adoptedResourceIds: [],
        alreadyActiveResourceIds: [],
        rejectedResourceIds: [],
        reusableBytes: 0,
      }),
      chooseMoveLocation: async () => null,
      moveLocation: async () => ({
        previousRoot: status.resourceRoot ?? "",
        currentRoot: status.resourceRoot ?? "",
        copiedBytes: 0,
        verifiedFileCount: 0,
        crossVolume: false,
        previousRootRetained: true,
      }),
      repairRoot: async () => status,
      reconnectRoot: async () => status,
      planCleanup: async () => ({
        resourceIds: [],
        reclaimableBytes: 0,
        confirmationRequired: true,
      }),
      cleanupUnused: async () => ({
        removedResourceIds: [],
        reclaimedBytes: 0,
      }),
      loadDiagnostics: async () => ({
        diagnostics: {
          generatedAtMs: Date.now(),
          catalogSource: "embedded",
          remoteCatalogEnabled: false,
          remoteSignaturePolicy: "ed25519-detached-v1-required-before-enable",
          rootState: "ready",
          resourceRoot: status.resourceRoot,
          preferredProfile: status.preferredProfile,
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
                  installPath:
                    "W:\\SiaoVPlay\\LocalResources\\packages\\yt-dlp\\2026.05.01",
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
                  installPath:
                    "W:\\SiaoVPlay\\LocalResources\\packages\\yt-dlp\\2026.04.01",
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
        thirdPartyNotices: "# SiaoVPlay 可选本地资源说明",
      }),
      diagnosticSummary: async () => "SiaoVPlay 本地资源诊断摘要",
      updateResource: async () => initialTask,
      rollbackResource: async (resourceId, version) => ({
        resourceId,
        previousVersion: version,
        activeVersion: version,
      }),
      planOldVersionCleanup: async () => ({
        candidates: [],
        protectedVersions: [],
        reclaimableBytes: 0,
        confirmationRequired: true,
      }),
      cleanupOldVersions: async () => ({
        removedVersions: [],
        reclaimedBytes: 0,
      }),
      selectProfile: async (profileId) => ({
        ...status,
        preferredProfile: profileId,
      }),
      setProxy: async (proxyUrl) => ({
        mode: proxyUrl ? "proxy" : "direct",
        proxySource: proxyUrl ? "custom" : "direct",
        proxyAddress: proxyUrl,
      }),
      prepareCapability: async (capabilityId, pendingActionId) => ({
        capabilityId,
        pendingActionId: pendingActionId ?? null,
        state: "preparing",
        resourceIds: [],
        readyResourceIds: [],
        taskIds: [],
      }),
      pauseTask: async (taskId) =>
        tasks.find((task) => task.id === taskId) ?? initialTask,
      resumeTask: async (taskId) => {
        const next = {
          ...(tasks.find((task) => task.id === taskId) ?? initialTask),
          state: "downloading" as const,
          errorCode: null,
          errorMessage: null,
        };
        setTasks((current) =>
          current.map((task) => (task.id === taskId ? next : task)),
        );
        return next;
      },
      cancelTask: async (taskId) => {
        const next = {
          ...(tasks.find((task) => task.id === taskId) ?? initialTask),
          state: "cancelled" as const,
        };
        setTasks((current) =>
          current.map((task) => (task.id === taskId ? next : task)),
        );
        return next;
      },
      retryTask: async (taskId) =>
        tasks.find((task) => task.id === taskId) ?? initialTask,
      repairResource: async () => initialTask,
      removeResource: async (resourceId) => ({
        resourceId,
        removed: false,
        affectedCapabilityIds: [],
      }),
    }),
    [tasks],
  );
  return <RuntimeView controller={controller} />;
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Local resources test root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <RuntimeHarness />
  </StrictMode>,
);
