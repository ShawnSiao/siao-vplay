import { vi } from "vitest";
import type { LocalResourcesController } from "../features/resources/useLocalResources";
import type { LocalResourceCatalog, LocalResourceStatus } from "../types";

export const catalog: LocalResourceCatalog = {
  schemaVersion: 1,
  productId: "siaovplay",
  updatedAt: "2026-08-20",
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
      version: "8.1.2-34-g9b6c8969e0",
      platform: "windows-x86_64",
      kind: "archive",
      bundled: false,
      installedSize: 175_929_962,
      license: "LGPL-2.1-or-later",
      sourcePage: "https://example.com/ffmpeg",
      artifact: {
        url: "https://example.com/ffmpeg.zip",
        size: 70_508_781,
        sha256: "a".repeat(64),
        format: "zip",
      },
      entrypoints: {},
      healthCheck: "ffmpeg-version",
    },
    {
      id: "yt-dlp",
      version: "2026.08.19",
      platform: "windows-x86_64",
      kind: "file",
      bundled: false,
      installedSize: 17_840_399,
      license: "GPL-3.0-or-later",
      sourcePage: "https://example.com/yt-dlp",
      artifact: {
        url: "https://example.com/yt-dlp.exe",
        size: 17_840_399,
        sha256: "b".repeat(64),
        format: "file",
      },
      entrypoints: {},
      healthCheck: "yt-dlp-version",
    },
  ],
};

export const setupStatus: LocalResourceStatus = {
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

export function makeController(
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
