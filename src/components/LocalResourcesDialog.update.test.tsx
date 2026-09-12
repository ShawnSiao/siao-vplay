import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LocalResourcesController } from "../features/resources/useLocalResources";
import type {
  LocalResourceCatalog,
  LocalResourceDiagnostics,
  LocalResourceStatus,
} from "../types";
import { LocalResourcesDialog } from "./LocalResourcesDialog";

const resourceIds = ["ffmpeg-cpu", "yt-dlp"];
const catalog: LocalResourceCatalog = {
  schemaVersion: 1,
  productId: "siaovplay",
  updatedAt: "2026-08-20",
  packageProfile: "app-only",
  bundlePolicy: { maximumExceptionBytes: 20_000_000, allowlistedResourceIds: [] },
  capabilities: [{
    id: "url_import",
    title: "在线视频导入",
    resourceIds,
    profileIds: [],
    requiresCapabilityIds: [],
  }],
  profiles: [],
  resources: resourceIds.map((id) => ({
    ...{ installedSize: null, expectedDownloadSize: null, artifact: null, entrypoints: {}, sourceCommit: null, patchSha256: null, requires: null, distribution: null },
    id,
    version: "current",
    platform: "windows-x86_64",
    kind: "file",
    bundled: false,
    installedSize: 1,
    license: "test",
    sourcePage: "https://example.com",
    artifact: {
      stripComponents: null,
      url: `https://example.com/${id}`,
      size: 1,
      sha256: "a".repeat(64),
      format: "file",
    },
    entrypoints: {},
    healthCheck: "sha256",
  })),
};
const status: LocalResourceStatus = {
  snapshotRevision: 1,
  configured: true,
  selectedParent: "W:\\SiaoVPlay",
  resourceRoot: "W:\\SiaoVPlay\\SiaoVPlay",
  rootState: "ready",
  freeSpaceBytes: null,
  preferredProfile: "standard",
  capabilities: [{
    id: "url_import",
    title: "在线视频导入",
    state: "update_available",
    requiredResourceIds: resourceIds,
    missingResourceIds: [],
  }],
};
const diagnostics: LocalResourceDiagnostics = {
  generatedAtMs: 1,
  catalogSource: "embedded",
  remoteCatalogEnabled: false,
  maintenance: { transactionState: "none", scanState: "complete", stagingReviewCount: 0, receiptRecoveryCopyCount: 0 }, remoteSignaturePolicy: "required",
  rootState: "ready",
  resourceRoot: status.resourceRoot,
  preferredProfile: "standard",
  resources: resourceIds.map((id) => ({
    id,
    catalogVersion: "current",
    activeVersion: "previous",
    state: "update_available",
    license: "test",
    sourcePage: "https://example.com",
    artifactSha256: "a".repeat(64),
    artifactUrl: `https://example.com/${id}`,
    healthCheck: "sha256",
    versionsReadable: true, unverifiedReceiptCount: 0, versions: [],
  })),
  tasks: [],
};

describe("LocalResourcesDialog capability updates", () => {
  it("turns the update status into an action for every outdated dependency", async () => {
    const updateResource = vi.fn().mockResolvedValue({});
    const controller = {
      catalog,
      status,
      tasks: [],
      taskMetrics: {},
      networkStatus: null,
      loading: false,
      error: null,
      clearError: vi.fn(),
      loadDiagnostics: vi.fn().mockResolvedValue({
        diagnostics,
        thirdPartyNotices: "",
      }),
      updateResource,
    } as unknown as LocalResourcesController;
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

    fireEvent.click(screen.getByRole("button", { name: "更新在线视频导入" }));
    await waitFor(() => expect(updateResource).toHaveBeenCalledTimes(2));
    expect(updateResource.mock.calls.map(([id]) => id)).toEqual(resourceIds);
  });
});
