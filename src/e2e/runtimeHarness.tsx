import { catalog } from "./runtimeCatalog";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import type { LocalResourcesController } from "../features/resources/useLocalResources";
import { RuntimeView, LiveRuntimeView } from "./RuntimeView";
import type {
  LocalResourceStatus,
  ResourceDownloadTask,
} from "../types";
import "../styles.css";

const status: LocalResourceStatus = {
  snapshotRevision: 1,
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
  version: "2026.08.19",
  state: "paused",
  downloadedBytes: 8_920_200,
  totalBytes: 17_840_399,
  requestedByCapabilityIds: ["url_import"],
  pendingActionIds: [],
  attempt: 1,
  errorCode: "pause_requested",
  errorMessage: "下载已暂停",
  createdAtMs: 1,
  updatedAtMs: 2,
  forceReinstall: false, generation: 1, revision: 1,
};

export function RuntimeHarness() {
  const [tasks, setTasks] = useState([initialTask]);
  const [cancellingMove, setCancellingMove] = useState(false);
  const controller = useMemo<LocalResourcesController>(
    () => ({
      catalog,
      status,
      tasks,
      taskMetrics: {
        [initialTask.id]: { bytesPerSecond: 0, remainingSeconds: null },
      },
      networkStatus: {
        snapshotRevision: 1, mode: "proxy",
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
        resourceRoot: status.resourceRoot ?? "", planFingerprint: "a".repeat(64), requestId: "preview-request",
        interruption: null, adoptedResourceIds: [],
        alreadyActiveResourceIds: [],
        rejectedResourceIds: [],
        reusableBytes: 0,
      }),
      chooseMoveLocation: async () => null,
      moving: new URLSearchParams(window.location.search).has("moving"),
      cancellingMove,
      cancelMove: async () => { setCancellingMove(true); return true; },
      moveLocation: async () => ({
        planFingerprint: "a".repeat(64), requestId: "preview-request",
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
        planFingerprint: "a".repeat(64),
        resourceIds: [],
        reclaimableBytes: 0,
        confirmationRequired: true,
      }),
      cleanupUnused: async () => ({
        removedResourceIds: [],
        interruption: null, reclaimedBytes: 0,
      }),
      loadDiagnostics: async () => ({
        diagnostics: {
          generatedAtMs: Date.now(),
          catalogSource: "embedded",
          remoteCatalogEnabled: false,
          maintenance: { transactionState: "none", scanState: "complete", stagingReviewCount: 0, receiptRecoveryCopyCount: 0 }, remoteSignaturePolicy: "ed25519-detached-v1-required-before-enable",
          rootState: "ready",
          resourceRoot: status.resourceRoot,
          preferredProfile: status.preferredProfile,
          resources: [
            {
              id: "yt-dlp",
              catalogVersion: "2026.08.19",
              activeVersion: "2026.05.01",
              state: "update_available",
              license: "GPL-3.0-or-later",
              sourcePage: "https://example.com/yt-dlp",
              artifactSha256: "b".repeat(64),
              artifactUrl: "https://example.com/yt-dlp.exe",
              healthCheck: "yt-dlp-version",
              versionsReadable: true, unverifiedReceiptCount: 0, versions: [
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
        planFingerprint: "a".repeat(64),
        candidates: [],
        protectedVersions: [],
        reclaimableBytes: 0,
        confirmationRequired: true,
      }),
      cleanupOldVersions: async () => ({
        removedVersions: [],
        interruption: null, reclaimedBytes: 0,
      }),
      selectProfile: async (profileId) => ({
        ...status,
        preferredProfile: profileId,
      }),
      setProxy: async (proxyUrl) => ({
        snapshotRevision: 2,
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
    [tasks, cancellingMove],
  );
  return <RuntimeView controller={controller} />;
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Local resources test root is missing.");
}

createRoot(root).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).has("live") ? <LiveRuntimeView /> : <RuntimeHarness />}
  </StrictMode>,
);
