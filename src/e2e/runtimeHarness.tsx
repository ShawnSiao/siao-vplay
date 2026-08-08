import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { LocalResourcesDialog } from "../components/LocalResourcesDialog";
import type { LocalResourcesController } from "../features/resources/useLocalResources";
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
      resourceIds: ["ffmpeg-cpu", "whisper-cpu", "whisper-vad-silero-6.2"],
      profileIds: ["fast", "standard"],
      requiresCapabilityIds: [],
    },
    {
      id: "accelerated_transcription",
      title: "高性能字幕识别",
      resourceIds: ["whisper-vulkan"],
      profileIds: [],
      requiresCapabilityIds: ["local_transcription"],
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
      version: "1.9.1-siaocut.1",
      platform: "windows-x86_64",
      kind: "runtime",
      bundled: false,
      installedSize: 9_751_754,
      expectedDownloadSize: 3_594_453,
      license: "MIT",
      sourcePage: "https://example.com/recognition-runtime",
      entrypoints: { whisperCli: "whisper-cli.exe" },
      healthCheck: "whisper-runtime-metadata-and-timeline",
      distribution: { status: "pending_release_asset" },
    },
    {
      id: "whisper-vad-silero-6.2",
      version: "6.2.0",
      platform: "any",
      kind: "model",
      bundled: false,
      installedSize: 885_098,
      license: "MIT",
      sourcePage: "https://example.com/vad",
      artifact: {
        url: "https://example.com/ggml-silero-v6.2.0.bin",
        size: 885_098,
        sha256: "d".repeat(64),
        format: "file",
      },
      entrypoints: { model: "ggml-silero-v6.2.0.bin" },
      healthCheck: "whisper-vad-magic",
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
    {
      id: "whisper-vulkan",
      version: "1.9.1-siaocut.1",
      platform: "windows-x86_64",
      kind: "runtime",
      bundled: false,
      installedSize: 58_320_931,
      expectedDownloadSize: 18_571_656,
      license: "MIT",
      sourcePage: "https://example.com/accelerated-runtime",
      entrypoints: { whisperCli: "whisper-cli.exe" },
      healthCheck: "whisper-runtime-metadata-and-timeline",
      distribution: { status: "pending_release_asset" },
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
        "whisper-vad-silero-6.2",
        "whisper-model-small",
      ],
      missingResourceIds: [
        "whisper-cpu",
        "whisper-vad-silero-6.2",
        "whisper-model-small",
      ],
    },
    {
      id: "accelerated_transcription",
      title: "高性能字幕识别",
      state: "not_ready",
      requiredResourceIds: ["whisper-vulkan"],
      missingResourceIds: ["whisper-vulkan"],
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
      loading: false,
      error: null,
      refresh: async () => status,
      clearError: () => undefined,
      chooseLocation: async () => null,
      confirmLocation: async () => status,
      inspectLegacyResources: async () => ({
        sources: [],
        candidates: [],
        verifiedResourceIds: [],
        reusableBytes: 0,
        rejectedCount: 0,
      }),
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
      selectProfile: async (profileId) => ({
        ...status,
        preferredProfile: profileId,
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
  return (
    <LocalResourcesDialog
      controller={controller}
      firstRun={false}
      pendingAction={null}
      previewMode={false}
      onClose={() => undefined}
      onDismissFirstRun={() => undefined}
      onNotice={() => undefined}
    />
  );
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
