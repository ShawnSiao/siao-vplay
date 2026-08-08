import { useMemo, useState } from "react";

import type { LocalResourcesController } from "../features/resources/useLocalResources";
import type {
  LocalResourceCapabilityStatus,
  LocalResourceLocationPlan,
  LocalResourceMovePlan,
  ResourceDownloadTask,
  ResourceMigrationPreview,
  UnusedResourceCleanupPlan,
} from "../types";
import { Dialog } from "./Dialog";

export type PendingResourceAction = {
  id: string;
  capabilityId: string;
  label: string;
  profileId?: "fast" | "standard";
};

type LocalResourcesDialogProps = {
  controller: LocalResourcesController;
  firstRun: boolean;
  pendingAction: PendingResourceAction | null;
  previewMode: boolean;
  onClose: () => void;
  onDismissFirstRun: () => void;
  onNotice: (message: string) => void;
};

type SetupChoice = "recommended" | "custom" | null;

const recommendedCapabilityIds = ["basic_media", "url_import"];

const capabilityDescriptions: Record<string, string> = {
  basic_media: "播放更多常见视频格式，并在需要时生成兼容播放版本。",
  url_import: "从公开 HTTPS 地址或公开视频页面保存本地副本。",
  local_transcription: "从英语、泰语、日语和韩语原声生成原文字幕。",
  accelerated_transcription: "兼容的电脑可以缩短本地字幕识别等待时间。",
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return "待确认";
  }
  if (bytes < 1_000) {
    return `${bytes} B`;
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }
  if (bytes < 1_000_000_000) {
    return `${(bytes / 1_000_000).toFixed(bytes >= 100_000_000 ? 0 : 1)} MB`;
  }
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function resourceDownloadBytes(
  resource: { artifact?: { size: number }; expectedDownloadSize?: number } | undefined,
): number {
  return resource?.artifact?.size ?? resource?.expectedDownloadSize ?? 0;
}

function formatRemaining(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "正在估算剩余时间";
  }
  if (seconds < 60) {
    return `预计不到 1 分钟`;
  }
  if (seconds < 3_600) {
    return `预计 ${Math.ceil(seconds / 60)} 分钟`;
  }
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  return `预计 ${hours} 小时 ${minutes} 分钟`;
}

function capabilityStateLabel(
  capability: LocalResourceCapabilityStatus,
  installable: boolean,
): string {
  switch (capability.state) {
    case "ready":
      return "已准备";
    case "preparing":
      return "准备中";
    case "repair_required":
      return "需要修复";
    case "root_unavailable":
      return "保存位置不可用";
    case "update_available":
      return "可更新";
    default:
      return installable ? "按需准备" : "下载资源尚未发布";
  }
}

function taskStateLabel(task: ResourceDownloadTask): string {
  switch (task.state) {
    case "queued":
      return "等待下载";
    case "downloading":
      return "正在下载";
    case "paused":
      return "已暂停";
    case "verifying":
      return "正在检查";
    case "installing":
      return "正在启用";
    case "completed":
      return "已完成";
    case "failed":
      return "准备失败";
    case "cancelled":
      return "已取消";
  }
}

export function LocalResourcesDialog({
  controller,
  firstRun,
  pendingAction,
  previewMode,
  onClose,
  onDismissFirstRun,
  onNotice,
}: LocalResourcesDialogProps) {
  const [setupChoice, setSetupChoice] = useState<SetupChoice>(
    firstRun && !pendingAction ? null : "custom",
  );
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState(
    new Set(pendingAction ? [pendingAction.capabilityId] : recommendedCapabilityIds),
  );
  const [selectedProfileId, setSelectedProfileId] = useState(
    pendingAction?.profileId ?? controller.status?.preferredProfile ?? "standard",
  );
  const [locationPlan, setLocationPlan] =
    useState<LocalResourceLocationPlan | null>(null);
  const [migrationSourcePath, setMigrationSourcePath] = useState<string | undefined>();
  const [migrationPreview, setMigrationPreview] =
    useState<ResourceMigrationPreview | null>(null);
  const [movePlan, setMovePlan] = useState<LocalResourceMovePlan | null>(null);
  const [cleanupPlan, setCleanupPlan] =
    useState<UnusedResourceCleanupPlan | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const { catalog, status, tasks, taskMetrics } = controller;

  const capabilityStatuses = useMemo(
    () => status?.capabilities ?? [],
    [status?.capabilities],
  );
  const statusByCapabilityId = useMemo(
    () => new Map(capabilityStatuses.map((capability) => [capability.id, capability])),
    [capabilityStatuses],
  );
  const resourceById = useMemo(
    () => new Map((catalog?.resources ?? []).map((resource) => [resource.id, resource])),
    [catalog],
  );
  const recommendedTotals = useMemo(() => {
    const resourceIds = new Set(
      (catalog?.capabilities ?? [])
        .filter((capability) => recommendedCapabilityIds.includes(capability.id))
        .flatMap((capability) => capability.resourceIds),
    );
    return [...resourceIds].reduce(
      (totals, resourceId) => {
        const resource = resourceById.get(resourceId);
        return {
          downloadBytes: totals.downloadBytes + resourceDownloadBytes(resource),
          installedBytes: totals.installedBytes + (resource?.installedSize ?? 0),
        };
      },
      { downloadBytes: 0, installedBytes: 0 },
    );
  }, [catalog?.capabilities, resourceById]);

  const missingResourceIdsByCapability = useMemo(() => {
    const result = new Map<string, string[]>();
    const profile = catalog?.profiles.find((item) => item.id === selectedProfileId);
    const collect = (capabilityId: string, visited: Set<string>): Set<string> => {
      if (visited.has(capabilityId)) {
        return new Set();
      }
      visited.add(capabilityId);
      const definition = catalog?.capabilities.find((item) => item.id === capabilityId);
      const statusItem = statusByCapabilityId.get(capabilityId);
      const ids = new Set<string>();
      for (const dependency of definition?.requiresCapabilityIds ?? []) {
        for (const resourceId of collect(dependency, visited)) {
          ids.add(resourceId);
        }
      }
      if (
        definition?.profileIds.includes(selectedProfileId) &&
        selectedProfileId !== status?.preferredProfile
      ) {
        for (const resourceId of definition.resourceIds) {
          ids.add(resourceId);
        }
        for (const resourceId of profile?.resourceIds ?? []) {
          ids.add(resourceId);
        }
      } else {
        for (const resourceId of statusItem?.missingResourceIds ?? []) {
          ids.add(resourceId);
        }
      }
      return ids;
    };
    for (const capability of capabilityStatuses) {
      result.set(capability.id, [...collect(capability.id, new Set())]);
    }
    return result;
  }, [
    capabilityStatuses,
    catalog?.capabilities,
    catalog?.profiles,
    selectedProfileId,
    status?.preferredProfile,
    statusByCapabilityId,
  ]);

  const capabilityInstallable = (capability: LocalResourceCapabilityStatus) =>
    capability.state === "ready" ||
    (missingResourceIdsByCapability.get(capability.id) ?? []).every(
      (resourceId) => resourceById.get(resourceId)?.artifact,
    );

  const selectedResourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const capabilityId of selectedCapabilityIds) {
      const capability = statusByCapabilityId.get(capabilityId);
      for (const resourceId of
        (capability && missingResourceIdsByCapability.get(capability.id)) ?? []) {
        ids.add(resourceId);
      }
    }
    return ids;
  }, [missingResourceIdsByCapability, selectedCapabilityIds, statusByCapabilityId]);

  const selectedDownloadBytes = [...selectedResourceIds].reduce(
    (total, resourceId) =>
      total + resourceDownloadBytes(resourceById.get(resourceId)),
    0,
  );
  const selectedInstalledBytes = [...selectedResourceIds].reduce(
    (total, resourceId) =>
      total + (resourceById.get(resourceId)?.installedSize ?? 0),
    0,
  );
  const selectedCapabilities = [...selectedCapabilityIds]
    .map((capabilityId) => statusByCapabilityId.get(capabilityId))
    .filter((capability): capability is LocalResourceCapabilityStatus =>
      Boolean(capability),
    );
  const selectionCanPrepare =
    selectedCapabilities.length > 0 &&
    selectedCapabilities.every(capabilityInstallable) &&
    selectedCapabilities.some(
      (capability) =>
        capability.state !== "ready" && capability.state !== "preparing",
    );
  const selectionPreparing = selectedCapabilities.some(
    (capability) => capability.state === "preparing",
  );
  const selectionUnavailable = selectedCapabilities.some(
    (capability) => !capabilityInstallable(capability),
  );

  const visibleTasks = tasks.filter(
    (task) => !["completed", "cancelled"].includes(task.state),
  );

  const capabilityTitleForTask = (task: ResourceDownloadTask) => {
    const requestedCapabilityId = task.requestedByCapabilityIds.find(
      (capabilityId) => statusByCapabilityId.has(capabilityId),
    );
    if (requestedCapabilityId) {
      return statusByCapabilityId.get(requestedCapabilityId)?.title ?? "本地功能";
    }
    const related = capabilityStatuses.find((capability) =>
      capability.requiredResourceIds.includes(task.resourceId),
    );
    return related?.title ?? "本地功能";
  };

  const runAction = async (action: string, operation: () => Promise<unknown>) => {
    setBusyAction(action);
    setLocalError(null);
    controller.clearError();
    try {
      await operation();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction(null);
    }
  };

  const chooseLocation = () =>
    runAction("location", async () => {
      const plan = await controller.chooseLocation();
      if (plan) {
        setLocationPlan(plan);
      }
    });

  const inspectLegacyResources = () =>
    runAction("inspect-legacy", async () => {
      const preview = await controller.inspectLegacyResources();
      setMigrationSourcePath(undefined);
      setMigrationPreview(preview);
    });

  const chooseExistingResources = () =>
    runAction("inspect-existing", async () => {
      const selection = await controller.chooseExistingResources();
      if (selection) {
        setMigrationSourcePath(selection.sourcePath);
        setMigrationPreview(selection.preview);
      }
    });

  const adoptExistingResources = () =>
    runAction("adopt-existing", async () => {
      const result = await controller.adoptResources(migrationSourcePath);
      setMigrationPreview(null);
      onNotice(
        result.adoptedResourceIds.length > 0
          ? `已接管 ${result.adoptedResourceIds.length} 项本地功能资源，无需重复下载。`
          : "没有需要接管的新资源。",
      );
    });

  const chooseMoveLocation = () =>
    runAction("plan-move", async () => {
      const plan = await controller.chooseMoveLocation();
      if (plan) {
        setMovePlan(plan);
      }
    });

  const confirmMoveLocation = () =>
    runAction("move-location", async () => {
      if (!movePlan) {
        return;
      }
      await controller.moveLocation(movePlan.selectedParent);
      setMovePlan(null);
      onNotice("资源已复制、校验并切换到新位置；原目录仍保留，可确认后自行清理。");
    });

  const repairRoot = () =>
    runAction("repair-root", async () => {
      await controller.repairRoot();
      onNotice("资源目录结构已修复，媒体库和项目数据未改变。");
    });

  const reconnectRoot = () =>
    runAction("reconnect-root", async () => {
      const result = await controller.reconnectRoot();
      if (result) {
        onNotice("已重新连接并验证现有资源目录。");
      }
    });

  const inspectCleanup = () =>
    runAction("plan-cleanup", async () => {
      const plan = await controller.planCleanup();
      setCleanupPlan(plan);
      if (plan.resourceIds.length === 0) {
        onNotice("当前没有未使用的本地功能资源。");
      }
    });

  const confirmCleanup = () =>
    runAction("cleanup-unused", async () => {
      const result = await controller.cleanupUnused();
      setCleanupPlan(null);
      onNotice(
        result.removedResourceIds.length > 0
          ? `已清理 ${result.removedResourceIds.length} 项未使用资源。`
          : "当前没有需要清理的资源。",
      );
    });

  const prepareSelection = async () => {
    const capabilities = selectedCapabilities.filter(
      (capability) =>
        capability.state !== "ready" && capability.state !== "preparing",
    );
    for (const capability of capabilities) {
      await controller.prepareCapability(
        capability.id,
        pendingAction?.capabilityId === capability.id
          ? pendingAction.id
          : undefined,
      );
    }
  };

  const confirmAndPrepare = () =>
    runAction("prepare", async () => {
      if (!status?.configured) {
        if (!locationPlan) {
          throw new Error("需要先选择并核对保存位置。");
        }
        const configured = await controller.confirmLocation(locationPlan.selectedParent);
        if (configured.preferredProfile !== selectedProfileId) {
          await controller.selectProfile(selectedProfileId);
        }
      }
      await prepareSelection();
      onNotice("本地功能已开始准备，可以继续查看下载进度。");
    });

  const selectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    if (status?.configured) {
      void runAction(`profile:${profileId}`, () => controller.selectProfile(profileId));
    }
  };

  const toggleCapability = (capabilityId: string) => {
    if (pendingAction?.capabilityId === capabilityId) {
      return;
    }
    setSelectedCapabilityIds((current) => {
      const next = new Set(current);
      if (next.has(capabilityId)) {
        next.delete(capabilityId);
      } else {
        next.add(capabilityId);
      }
      return next;
    });
  };

  const activeResourceIds = new Set(
    capabilityStatuses.flatMap((capability) =>
      capability.requiredResourceIds.filter(
        (resourceId) => !capability.missingResourceIds.includes(resourceId),
      ),
    ),
  );

  return (
    <Dialog
      title={firstRun ? "准备 SiaoVPlay" : "本地功能资源"}
      eyebrow={pendingAction ? "继续上一步操作" : "按需下载 · 本机保存"}
      onClose={onClose}
      actions={
        <button className="button quiet" type="button" onClick={onClose}>
          {pendingAction ? "取消此次操作" : "完成"}
        </button>
      }
    >
      <div className="local-resources-dialog">
        {previewMode ? (
          <div className="notice" role="status">
            <strong>当前为界面预览</strong>
            <p>目录选择、下载和修复操作只在桌面应用中执行。</p>
          </div>
        ) : null}

        {pendingAction ? (
          <div className="local-resources-pending" role="status">
            <span aria-hidden="true">↗</span>
            <div>
              <strong>{pendingAction.label}</strong>
              <p>所需功能准备完成后，将自动返回并继续这一步。</p>
            </div>
          </div>
        ) : null}

        {firstRun && setupChoice === null ? (
          <section className="local-resources-welcome" aria-labelledby="resource-welcome-title">
            <h3 id="resource-welcome-title">先选择需要准备的功能</h3>
            <p>
              产品本体已经可以使用。其他功能只在需要时下载，并保存到确认的位置。
            </p>
            <div className="local-resources-choice-grid">
              <button
                className="local-resources-choice recommended"
                type="button"
                onClick={() => {
                  setSelectedCapabilityIds(new Set(recommendedCapabilityIds));
                  setSetupChoice("recommended");
                }}
              >
                <strong>使用推荐配置</strong>
                <span>准备基础视频支持和在线视频导入。</span>
                <small>
                  {catalog
                    ? `下载约 ${formatBytes(
                        recommendedTotals.downloadBytes,
                      )}，安装后约占用 ${formatBytes(
                        recommendedTotals.installedBytes,
                      )}`
                    : "正在计算下载量"}
                </small>
              </button>
              <button
                className="local-resources-choice"
                type="button"
                onClick={() => setSetupChoice("custom")}
              >
                <strong>选择需要的功能</strong>
                <span>按实际用途选择，之后仍可调整。</span>
                <small>下载量随选择即时计算</small>
              </button>
              <button
                className="local-resources-choice later"
                type="button"
                onClick={onDismissFirstRun}
              >
                <strong>稍后设置</strong>
                <span>直接进入媒体库，需要时再准备。</span>
                <small>不会开始下载</small>
              </button>
            </div>
          </section>
        ) : null}

        {controller.loading && !status ? (
          <div className="local-resources-loading" role="status">
            <span className="spinner" />
            <span>正在读取本地功能状态…</span>
          </div>
        ) : null}

        {status && (!firstRun || setupChoice !== null || pendingAction) ? (
          <>
            <section className="local-resources-section" aria-labelledby="capability-heading">
              <div className="local-resources-section-head">
                <div>
                  <h3 id="capability-heading">需要的功能</h3>
                  <p>只下载所选功能缺少的内容，共享内容不会重复下载。</p>
                </div>
                {firstRun && !pendingAction ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setSetupChoice(null)}
                  >
                    返回选择方式
                  </button>
                ) : null}
              </div>
              {catalog?.profiles.length ? (
                <fieldset className="local-resource-profiles">
                  <legend>字幕识别方式</legend>
                  <p>方式只影响字幕识别。下载量按可信资源清单计算，并直接展示真实大小。</p>
                  <div>
                    {catalog.profiles.map((profile) => {
                      const modelBytes = profile.resourceIds.reduce(
                        (total, resourceId) =>
                          total + resourceDownloadBytes(resourceById.get(resourceId)),
                        0,
                      );
                      return (
                        <label key={profile.id}>
                          <input
                            type="radio"
                            name="local-resource-profile"
                            value={profile.id}
                            checked={selectedProfileId === profile.id}
                            disabled={previewMode || busyAction !== null}
                            onChange={() => selectProfile(profile.id)}
                          />
                          <span>
                            <strong>
                              {profile.title}
                              {profile.recommended ? "（推荐）" : ""}
                            </strong>
                            <small>
                              识别模型下载 {formatBytes(modelBytes)}；完整准备量见下方汇总
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}
              <div className="local-capability-list">
                {capabilityStatuses.map((capability) => {
                  const installable = capabilityInstallable(capability);
                  const selected = selectedCapabilityIds.has(capability.id);
                  const locked = pendingAction?.capabilityId === capability.id;
                  const missingResourceIds =
                    missingResourceIdsByCapability.get(capability.id) ?? [];
                  const downloadBytes = missingResourceIds.reduce(
                    (total, resourceId) =>
                      total + resourceDownloadBytes(resourceById.get(resourceId)),
                    0,
                  );
                  return (
                    <label
                      className={`local-capability-card ${selected ? "selected" : ""} ${
                        !installable ? "unavailable" : ""
                      }`}
                      key={capability.id}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={
                          previewMode ||
                          locked ||
                          capability.state === "ready" ||
                          !installable ||
                          busyAction !== null
                        }
                        onChange={() => toggleCapability(capability.id)}
                      />
                      <span className="local-capability-copy">
                        <strong>{capability.title}</strong>
                        <span>
                          {capabilityDescriptions[capability.id] ??
                            "在需要时准备对应的本地功能。"}
                        </span>
                        <small>
                          {capability.state === "ready"
                            ? "无需下载"
                            : installable
                              ? `需下载 ${formatBytes(downloadBytes)}`
                              : "当前不能开始下载"}
                        </small>
                      </span>
                      <span
                        className={`status-pill ${
                          capability.state === "ready" ? "ready" : "warning"
                        }`}
                      >
                        {capabilityStateLabel(capability, installable)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="local-resources-section" aria-labelledby="location-heading">
              <div className="local-resources-section-head">
                <div>
                  <h3 id="location-heading">保存位置</h3>
                  <p>下载、暂存和安装都在确认的位置完成，不会使用隐式系统盘目录。</p>
                </div>
                {!status.configured ? (
                  <button
                    className="button quiet"
                    type="button"
                    disabled={previewMode || busyAction !== null}
                    onClick={() => void chooseLocation()}
                  >
                    {busyAction === "location" ? "正在读取…" : "选择位置"}
                  </button>
                ) : null}
              </div>
              <div className="local-resources-path" title={status.resourceRoot ?? undefined}>
                {locationPlan?.resourceRoot ??
                  status.resourceRoot ??
                  "尚未选择保存位置"}
              </div>
              <dl className="local-resources-space-summary">
                <div>
                  <dt>预计下载</dt>
                  <dd title={`${selectedDownloadBytes} 字节`}>
                    {formatBytes(selectedDownloadBytes)}
                  </dd>
                </div>
                <div>
                  <dt>安装后占用</dt>
                  <dd title={`${selectedInstalledBytes} 字节`}>
                    {formatBytes(selectedInstalledBytes)}
                  </dd>
                </div>
                <div>
                  <dt>磁盘可用</dt>
                  <dd>
                    {formatBytes(locationPlan?.freeSpaceBytes ?? status.freeSpaceBytes)}
                  </dd>
                </div>
              </dl>
              {locationPlan && !status.configured ? (
                <div className="notice local-resources-confirmation" role="status">
                  <strong>下载尚未开始</strong>
                  <p>核对实际保存位置和空间后，再确认并开始准备。</p>
                </div>
              ) : null}
              {status.configured && status.rootState !== "ready" ? (
                <div className="notice danger" role="status">
                  <strong>
                    {status.rootState === "root_unavailable"
                      ? "原资源位置当前不可用"
                      : "资源目录需要修复"}
                  </strong>
                  <p>不会删除任何记录。可以重新连接已有目录，或在原位置重建目录结构。</p>
                  <div className="local-resource-location-actions">
                    <button
                      className="button quiet"
                      type="button"
                      disabled={previewMode || busyAction !== null}
                      onClick={() => void reconnectRoot()}
                    >
                      {busyAction === "reconnect-root" ? "正在验证…" : "重新连接目录"}
                    </button>
                    <button
                      className="button quiet"
                      type="button"
                      disabled={previewMode || busyAction !== null}
                      onClick={() => void repairRoot()}
                    >
                      {busyAction === "repair-root" ? "正在修复…" : "在原位置修复"}
                    </button>
                  </div>
                </div>
              ) : null}
              {status.configured && status.rootState === "ready" ? (
                <div className="local-resource-location-actions">
                  <button
                    className="button quiet"
                    type="button"
                    disabled={previewMode || busyAction !== null}
                    onClick={() => void inspectLegacyResources()}
                  >
                    {busyAction === "inspect-legacy" ? "正在检查…" : "检查旧版资源"}
                  </button>
                  <button
                    className="button quiet"
                    type="button"
                    disabled={previewMode || busyAction !== null}
                    onClick={() => void chooseExistingResources()}
                  >
                    {busyAction === "inspect-existing"
                      ? "正在验证…"
                      : "选择现有资源目录"}
                  </button>
                  <button
                    className="button quiet"
                    type="button"
                    disabled={previewMode || busyAction !== null}
                    onClick={() => void chooseMoveLocation()}
                  >
                    {busyAction === "plan-move" ? "正在计算…" : "移动保存位置"}
                  </button>
                </div>
              ) : null}
              {migrationPreview ? (
                <div className="notice local-resources-confirmation" role="status">
                  <strong>
                    {migrationPreview.verifiedResourceIds.length > 0
                      ? `发现 ${migrationPreview.verifiedResourceIds.length} 项可复用资源`
                      : "没有发现可接管的资源"}
                  </strong>
                  <p>
                    {migrationPreview.verifiedResourceIds.length > 0
                      ? `已按当前清单验证，可复用 ${formatBytes(
                          migrationPreview.reusableBytes,
                        )}，不会读取 Component Store 数据库或租约。`
                      : "候选文件未通过当前版本、大小、哈希、文件清单或健康检查。"}
                  </p>
                  {migrationPreview.verifiedResourceIds.length > 0 ? (
                    <button
                      className="button quiet"
                      type="button"
                      disabled={previewMode || busyAction !== null}
                      onClick={() => void adoptExistingResources()}
                    >
                      {busyAction === "adopt-existing" ? "正在接管…" : "接管已验证资源"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {movePlan ? (
                <div className="notice local-resources-confirmation" role="status">
                  <strong>核对新的保存位置</strong>
                  <p>{movePlan.resourceRoot}</p>
                  <p>
                    复制并校验 {formatBytes(movePlan.bytesToCopy)}；切换成功后原目录仍保留。
                  </p>
                  <button
                    className="button quiet"
                    type="button"
                    disabled={
                      previewMode ||
                      busyAction !== null ||
                      movePlan.destinationExists ||
                      (movePlan.freeSpaceBytes !== null &&
                        movePlan.freeSpaceBytes < movePlan.bytesToCopy)
                    }
                    onClick={() => void confirmMoveLocation()}
                  >
                    {busyAction === "move-location" ? "正在复制并校验…" : "确认复制并切换"}
                  </button>
                </div>
              ) : null}
              <button
                className="button primary local-resources-primary-action"
                type="button"
                disabled={
                  previewMode ||
                  busyAction !== null ||
                  !selectionCanPrepare ||
                  (!status.configured && !locationPlan)
                }
                onClick={() => void confirmAndPrepare()}
              >
                {busyAction === "prepare"
                  ? "正在建立准备任务…"
                  : !status.configured
                    ? "确认位置并开始准备"
                    : selectionCanPrepare
                      ? "开始准备所选功能"
                      : selectionPreparing
                        ? "正在准备所选功能"
                        : selectionUnavailable
                          ? "当前不能开始准备"
                          : "所选功能已准备"}
              </button>
            </section>
          </>
        ) : null}

        {visibleTasks.length > 0 ? (
          <section className="local-resources-section" aria-labelledby="downloads-heading">
            <div className="local-resources-section-head">
              <div>
                <h3 id="downloads-heading">准备进度</h3>
                <p>关闭窗口不会停止任务，暂停后可从现有进度继续。</p>
              </div>
            </div>
            <div className="local-resource-task-list">
              {visibleTasks.map((task) => {
                const metric = taskMetrics[task.id];
                const progress =
                  task.totalBytes > 0
                    ? Math.min(100, (task.downloadedBytes / task.totalBytes) * 100)
                    : 0;
                return (
                  <article className="local-resource-task" key={task.id}>
                    <div className="local-resource-task-head">
                      <div>
                        <strong>{capabilityTitleForTask(task)}</strong>
                        <span>{taskStateLabel(task)}</span>
                      </div>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div
                      className="local-resource-progress"
                      role="progressbar"
                      aria-label={`${capabilityTitleForTask(task)}准备进度`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress)}
                    >
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    <div className="local-resource-task-meta">
                      <span>
                        {formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes)}
                      </span>
                      {task.state === "downloading" ? (
                        <span>
                          {metric?.bytesPerSecond
                            ? `${formatBytes(metric.bytesPerSecond)}/秒 · ${formatRemaining(
                                metric.remainingSeconds,
                              )}`
                            : "正在估算速度和剩余时间"}
                        </span>
                      ) : null}
                    </div>
                    {task.errorMessage && task.state === "failed" ? (
                      <p className="local-resource-task-error" role="alert">
                        {task.errorMessage}
                      </p>
                    ) : null}
                    <div className="local-resource-task-actions">
                      {["queued", "downloading"].includes(task.state) ? (
                        <button
                          className="button quiet"
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void runAction(`pause-${task.id}`, () =>
                              controller.pauseTask(task.id),
                            )
                          }
                        >
                          暂停
                        </button>
                      ) : null}
                      {task.state === "paused" ? (
                        <button
                          className="button quiet"
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void runAction(`resume-${task.id}`, () =>
                              controller.resumeTask(task.id),
                            )
                          }
                        >
                          继续
                        </button>
                      ) : null}
                      {task.state === "failed" ? (
                        <button
                          className="button quiet"
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void runAction(`retry-${task.id}`, () =>
                              controller.retryTask(task.id),
                            )
                          }
                        >
                          重新尝试
                        </button>
                      ) : null}
                      {["queued", "downloading", "paused"].includes(task.state) ? (
                        <button
                          className="text-button danger"
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void runAction(`cancel-${task.id}`, () =>
                              controller.cancelTask(task.id),
                            )
                          }
                        >
                          取消
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {catalog && status ? (
          <details className="local-resource-diagnostics">
            <summary>高级诊断与第三方许可</summary>
            <p>
              以下信息用于核对资源版本、完整性和许可证。普通使用不需要修改这些内容。
            </p>
            <div className="local-resource-diagnostic-list">
              {catalog.resources.map((resource) => (
                <article key={resource.id}>
                  <div>
                    <strong>{resource.id}</strong>
                    <span>{resource.version}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>下载大小</dt>
                      <dd>
                        {formatBytes(
                          resource.artifact?.size ?? resource.expectedDownloadSize,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>安装后大小</dt>
                      <dd>{formatBytes(resource.installedSize)}</dd>
                    </div>
                    <div>
                      <dt>许可证</dt>
                      <dd>{resource.license}</dd>
                    </div>
                  </dl>
                  {resource.artifact ? (
                    <code>SHA-256 {resource.artifact.sha256}</code>
                  ) : (
                    <span>尚无可下载制品</span>
                  )}
                  <a href={resource.sourcePage} target="_blank" rel="noreferrer">
                    查看来源与许可说明
                  </a>
                  {activeResourceIds.has(resource.id) && resource.artifact ? (
                    <button
                      className="button quiet"
                      type="button"
                      disabled={busyAction !== null || previewMode}
                      onClick={() =>
                        void runAction(`repair-${resource.id}`, () =>
                          controller.repairResource(resource.id),
                        )
                      }
                    >
                      修复 {resource.id}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="local-resource-location-actions">
              <button
                className="button quiet"
                type="button"
                disabled={previewMode || busyAction !== null}
                onClick={() => void inspectCleanup()}
              >
                {busyAction === "plan-cleanup" ? "正在计算…" : "检查未使用资源"}
              </button>
              {cleanupPlan && cleanupPlan.resourceIds.length > 0 ? (
                <button
                  className="text-button danger"
                  type="button"
                  disabled={previewMode || busyAction !== null}
                  onClick={() => void confirmCleanup()}
                >
                  {busyAction === "cleanup-unused"
                    ? "正在清理…"
                    : `清理 ${formatBytes(cleanupPlan.reclaimableBytes)}`}
                </button>
              ) : null}
            </div>
          </details>
        ) : null}

        {localError || controller.error ? (
          <div className="notice danger" role="alert">
            <strong>本地功能未完成准备</strong>
            <p>{localError ?? controller.error}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
