import { useMemo, useRef, useState } from "react";
import { ResourcePreparationAction } from "../features/resources/ResourcePreparationAction";

import type { LocalResourcesController } from "../features/resources/useLocalResources";
import { updateCapabilityResources } from "../features/environment-settings/updateCapabilityResources";
import {
  capabilityDescriptions,
  formatBytes,
  formatRemaining,
  networkSourceLabel,
  resourceDownloadBytes,
  taskStateLabel,
} from "../features/environment-settings/localResourcePresentation";
import { CapabilityStatusPill } from "../features/environment-settings/CapabilityStatusPill";
import type {
  LocalResourceCapabilityStatus,
  LocalResourceDiagnostics,
  LocalResourceLocationPlan,
  LocalResourceMovePlan,
  ResourceDownloadTask,
  ResourceMigrationPreview,
  UnusedResourceCleanupPlan,
  OldResourceVersionCleanupPlan,
} from "../types";
import { Dialog } from "./Dialog";

import type { PendingResourceAction } from "../features/resources/pendingResourceAction";
export type { PendingResourceAction } from "../features/resources/pendingResourceAction";

type LocalResourcesDialogProps = {
  controller: LocalResourcesController;
  firstRun: boolean;
  embedded?: boolean;
  pendingAction: PendingResourceAction | null;
  previewMode: boolean;
  onClose: () => void;
  onDismissFirstRun: () => void;
  onNotice: (message: string) => void;
};

const recommendedCapabilityIds = ["basic_media", "url_import"];

export function LocalResourcesDialog({
  controller,
  firstRun,
  embedded = false,
  pendingAction,
  previewMode,
  onClose,
  onDismissFirstRun,
  onNotice,
}: LocalResourcesDialogProps) {
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
  const [diagnostics, setDiagnostics] = useState<LocalResourceDiagnostics | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(
    !controller.status?.configured,
  );
  const diagnosticsRef = useRef<HTMLDetailsElement>(null);
  const [thirdPartyNotices, setThirdPartyNotices] = useState<string | null>(null);
  const [oldVersionCleanupPlan, setOldVersionCleanupPlan] =
    useState<OldResourceVersionCleanupPlan | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [proxyInput, setProxyInput] = useState("");
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
    capability.state === "update_available" ||
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
        capability.state !== "ready" &&
        capability.state !== "update_available" &&
        capability.state !== "preparing",
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
    if (action !== "load-diagnostics") {
      setLocalError(null);
      controller.clearError();
    }
    try {
      await operation();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setLocalError(previous => action === "load-diagnostics" ? previous ?? message : message);
    } finally {
      setBusyAction(current => current === action ? null : current);
    }
  };

  const chooseLocation = () =>
    runAction("location", async () => {
      const plan = await controller.chooseLocation();
      if (plan) {
        setLocationPlan(plan);
      }
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
      if (!cleanupPlan) throw new Error("请先检查清理清单。");
      const plan = cleanupPlan;
      setCleanupPlan(null);
      setOldVersionCleanupPlan(null);
      setDiagnostics(null);
      const result = await controller.cleanupUnused(plan.planFingerprint);
      onNotice(
        result.removedResourceIds.length > 0
          ? `已清理 ${result.removedResourceIds.length} 项未使用资源。`
          : "当前没有需要清理的资源。",
      );
    });

  const loadDiagnostics = () =>
    runAction("load-diagnostics", async () => {
      const result = await controller.loadDiagnostics();
      setDiagnostics(result.diagnostics);
      setThirdPartyNotices(result.thirdPartyNotices);
    });

  const revealDiagnostics = () => {
    setDiagnosticsOpen(true);
    window.requestAnimationFrame(() => {
      diagnosticsRef.current?.scrollIntoView({ block: "start" });
    });
  };

  const copyDiagnosticSummary = () =>
    runAction("copy-diagnostics", async () => {
      const summary = await controller.diagnosticSummary();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = summary;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      onNotice("已复制脱敏后的本地资源诊断摘要。");
    });

  const updateResource = (resourceId: string) =>
    runAction(`update-${resourceId}`, async () => {
      await controller.updateResource(resourceId);
      setDiagnostics(null);
      onNotice("资源更新已开始；新版本验证通过前会继续使用当前版本。");
    });

  const updateCapability = (capability: LocalResourceCapabilityStatus) =>
    runAction(`update-capability-${capability.id}`, async () => {
      const result = await updateCapabilityResources(controller, capability);
      if (result.updatedResourceIds.length === 0) {
        setDiagnostics(result.diagnostics);
        setThirdPartyNotices(result.thirdPartyNotices);
        onNotice(`${capability.title}当前没有需要更新的内容。`);
        return;
      }
      setDiagnostics(null);
      onNotice(
        `${capability.title}更新已开始；新版本验证通过前会继续使用当前版本。`,
      );
    });

  const rollbackResource = (resourceId: string, version: string) =>
    runAction(`rollback-${resourceId}-${version}`, async () => {
      await controller.rollbackResource(resourceId, version);
      const result = await controller.loadDiagnostics();
      setDiagnostics(result.diagnostics);
      setThirdPartyNotices(result.thirdPartyNotices);
      onNotice(`已切换到已验证版本 ${version}。`);
    });

  const inspectOldVersionCleanup = () =>
    runAction("plan-old-version-cleanup", async () => {
      const plan = await controller.planOldVersionCleanup();
      setOldVersionCleanupPlan(plan);
      if (plan.candidates.length === 0) {
        onNotice("当前没有可清理的旧资源版本；活动版本和最近一个历史版本会保留。");
      }
    });

  const confirmOldVersionCleanup = () =>
    runAction("cleanup-old-versions", async () => {
      if (!oldVersionCleanupPlan) throw new Error("请先检查旧版本清理清单。");
      const plan = oldVersionCleanupPlan;
      setOldVersionCleanupPlan(null);
      setCleanupPlan(null);
      setDiagnostics(null);
      const result = await controller.cleanupOldVersions(plan.planFingerprint);
      onNotice(
        result.removedVersions.length > 0
          ? `已清理 ${result.removedVersions.length} 个旧资源版本。`
          : "当前没有需要清理的旧版本。",
      );
    });

  const prepareSelection = async () => {
    const capabilities = selectedCapabilities.filter(
      (capability) =>
        capability.state !== "ready" &&
        capability.state !== "update_available" &&
        capability.state !== "preparing",
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

  const confirmFirstRunLocation = () =>
    runAction("first-run-location", async () => {
      if (!locationPlan) {
        throw new Error("请先选择保存位置。");
      }
      await controller.confirmLocation(locationPlan.selectedParent);
      onNotice("本地功能保存位置已设置；需要其他能力时再按需下载。");
      onDismissFirstRun();
    });

  const applyProxy = (proxyUrl: string | null) =>
    runAction("proxy", async () => {
      const result = await controller.setProxy(proxyUrl);
      if (proxyUrl === null) {
        setProxyInput("");
      }
      onNotice(
        result.proxySource === "custom"
          ? "已使用指定代理，后续下载任务会采用新设置。"
          : "已恢复自动网络设置。",
      );
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
  const content = (
      <div className={`local-resources-dialog ${embedded ? "local-resources-embedded" : ""}`}>
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

        {controller.moving ? <div className="notice" role="status">
          <strong>{controller.cancellingMove ? "正在停止资源复制…" : "正在复制并校验资源，原位置仍保留"}</strong>
          <button className="button quiet" type="button" disabled={controller.cancellingMove || !controller.cancelMove} onClick={() => {
            void controller.cancelMove?.().then((accepted) => {
              if (!accepted) onNotice("已进入保存位置切换，请等待完成。");
            }).catch((error: unknown) => setLocalError(error instanceof Error ? error.message : "取消请求没有完成，请重试。"));
          }}>取消复制</button>
        </div> : null}
        {localError || controller.error ? (
          <div className="notice danger" role="alert">
            <strong>本地功能未完成准备</strong>
            <p>{localError ?? controller.error}</p>
          </div>
        ) : null}

        {firstRun && !pendingAction ? (
          <section className="local-resources-welcome" aria-labelledby="resource-welcome-title">
            <h3 id="resource-welcome-title">选择本地功能的保存位置</h3>
            <p>
              SiaoVPlay 产品本体已经可以使用。以后需要的视频兼容、在线导入或字幕识别内容，会按需下载到这里。
            </p>
            <div className="local-resources-first-run-location">
              <div
                className="local-resources-path"
                title={locationPlan?.resourceRoot ?? undefined}
              >
                {locationPlan?.resourceRoot ?? "尚未选择保存位置"}
              </div>
              <button
                className="button quiet"
                type="button"
                disabled={previewMode || busyAction !== null}
                onClick={() => void chooseLocation()}
              >
                {busyAction === "location" ? "正在打开…" : "选择保存位置"}
              </button>
            </div>
            {locationPlan ? (
              <dl className="local-resources-space-summary">
                <div>
                  <dt>磁盘可用</dt>
                  <dd>{formatBytes(locationPlan.freeSpaceBytes)}</dd>
                </div>
                <div>
                  <dt>现在下载</dt>
                  <dd>0 B</dd>
                </div>
                <div>
                  <dt>以后下载</dt>
                  <dd>按需确认</dd>
                </div>
              </dl>
            ) : null}
            <div className="local-resource-location-actions">
              <button
                className="button primary"
                type="button"
                disabled={previewMode || busyAction !== null || !locationPlan}
                onClick={() => void confirmFirstRunLocation()}
              >
                {busyAction === "first-run-location" ? "正在保存…" : "保存位置并进入"}
              </button>
              <button
                className="button quiet"
                type="button"
                onClick={onDismissFirstRun}
              >
                稍后设置
              </button>
            </div>
            <small className="local-resources-first-run-note">
              此步骤不会下载依赖包或模型；每项功能会在首次使用前单独显示下载量并再次确认。
            </small>
          </section>
        ) : null}

        {controller.loading && !status ? (
          <div className="local-resources-loading" role="status">
            <span className="spinner" />
            <span>正在读取本地功能状态…</span>
          </div>
        ) : null}

        {status && (!firstRun || pendingAction) ? (
          <>
            <section className="local-resources-section local-resources-capabilities-section" aria-labelledby="capability-heading">
              <div className="local-resources-section-head">
                <div>
                  <h3 id="capability-heading">需要的功能</h3>
                  <p>只下载所选功能缺少的内容，共享内容不会重复下载。</p>
                </div>
              </div>
              {catalog?.profiles.length && (!pendingAction || selectedCapabilities.some(capability =>
                catalog.capabilities.find(item => item.id === capability.id)?.profileIds.length,
              )) ? (
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
                              {profile.id === "fast" ? "轻量" : profile.title}
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
                {capabilityStatuses.filter(capability => !pendingAction || capability.id === pendingAction.capabilityId).map((capability) => {
                  const installable = capabilityInstallable(capability);
                  const selected = selectedCapabilityIds.has(capability.id);
                  const ready =
                    capability.state === "ready" ||
                    capability.state === "update_available";
                  const locked = pendingAction?.capabilityId === capability.id;
                  const missingResourceIds =
                    missingResourceIdsByCapability.get(capability.id) ?? [];
                  const downloadBytes = missingResourceIds.reduce(
                    (total, resourceId) =>
                      total + resourceDownloadBytes(resourceById.get(resourceId)),
                    0,
                  );
                  return (
                    <div
                      className={`local-capability-card ${selected && !ready ? "selected" : ""} ${
                        ready ? "ready" : ""
                      } ${
                        !installable ? "unavailable" : ""
                      }`}
                      key={capability.id}
                    >
                      {ready ? (
                        <span
                          className="local-capability-ready-mark"
                          role="img"
                          aria-label="已准备"
                        >
                          ✓
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={`选择准备${capability.title}`}
                          checked={selected}
                          disabled={
                            previewMode ||
                            locked ||
                            !installable ||
                            busyAction !== null
                          }
                          onChange={() => toggleCapability(capability.id)}
                        />
                      )}
                      <span className="local-capability-copy">
                        <strong>{capability.title}</strong>
                        <span>
                          {capabilityDescriptions[capability.id] ??
                            "在需要时准备对应的本地功能。"}
                        </span>
                        <small>
                          {capability.state === "ready" ||
                          capability.state === "update_available"
                            ? capability.state === "update_available"
                              ? "当前可用，可选择更新"
                              : "无需下载"
                            : installable
                              ? `需下载 ${formatBytes(downloadBytes)}`
                              : "当前不能开始下载"}
                        </small>
                      </span>
                      <CapabilityStatusPill
                        capability={capability}
                        installable={installable}
                        busy={busyAction === `update-capability-${capability.id}`}
                        previewMode={previewMode}
                        onUpdate={() => void updateCapability(capability)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            <ResourcePreparationAction
              downloadBytes={selectedDownloadBytes} installedBytes={selectedInstalledBytes}
              path={status.resourceRoot ?? locationPlan?.resourceRoot ?? null}
              busy={busyAction === "prepare"} configured={status.configured}
              canPrepare={selectionCanPrepare} preparing={selectionPreparing} unavailable={selectionUnavailable}
              disabled={previewMode || busyAction !== null || !selectionCanPrepare || (!status.configured && !locationPlan)}
              onPrepare={() => void confirmAndPrepare()}
            />

            <details
              className="local-resources-maintenance"
              open={
                !status.configured ||
                status.rootState !== "ready" ||
                maintenanceOpen
              }
              onToggle={(event) => setMaintenanceOpen(event.currentTarget.open)}
            >
              <summary>高级维护：存储位置、迁移、修复和清理</summary>
            <section className="local-resources-section local-resources-location-section" aria-labelledby="location-heading">
              <div className="local-resources-section-head">
                <div>
                  <h3 id="location-heading">保存位置</h3>
                  <p>下载、暂存和安装都在确认的位置完成，不会使用隐式系统盘目录。</p>
                </div>
                <button
                  className="button quiet"
                  type="button"
                  disabled={previewMode || busyAction !== null}
                  onClick={() =>
                    void (status.configured ? chooseMoveLocation() : chooseLocation())
                  }
                >
                  {busyAction === "location" || busyAction === "plan-move"
                    ? "正在打开…"
                    : status.configured
                      ? "移动保存位置"
                      : "选择保存位置"}
                </button>
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
                    onClick={revealDiagnostics}
                  >
                    检查与修复
                  </button>
                  <button
                    className="button quiet"
                    type="button"
                    disabled={previewMode || busyAction !== null}
                    onClick={() => {
                      revealDiagnostics();
                      void inspectOldVersionCleanup();
                    }}
                  >
                    清理旧版本
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
                        )}。只检查了明确选择的目录，不会读取其他应用的数据。`
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
                    中断后选择同一位置可继续，空间按剩余复制量检查。
                  </p>
                  <button
                    className="button quiet"
                    type="button"
                    disabled={
                      previewMode ||
                      busyAction !== null ||
                      movePlan.destinationExists
                    }
                    onClick={() => void confirmMoveLocation()}
                  >
                    {busyAction === "move-location" ? "正在复制并校验…" : "确认复制并切换"}
                  </button>
                </div>
              ) : null}

            </section>
            </details>
          </>
        ) : null}

        {visibleTasks.length > 0 ? (
          <section className="local-resources-section local-resources-downloads-section" aria-labelledby="downloads-heading">
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
          <details
            ref={diagnosticsRef}
            className="local-resource-diagnostics"
            open={diagnosticsOpen}
            onToggle={(event) => {
              setDiagnosticsOpen(event.currentTarget.open);
              if (event.currentTarget.open && !diagnostics && busyAction === null) {
                void loadDiagnostics();
              }
            }}
          >
            <summary>高级诊断与第三方许可</summary>
            <p>
              以下信息用于核对资源版本、完整性和许可证。普通使用不需要修改这些内容。
            </p>
            <section className="local-resource-network-settings" aria-labelledby="network-settings-heading">
              <div>
                <strong id="network-settings-heading">下载网络</strong>
                <span>{networkSourceLabel(controller.networkStatus?.proxySource)}</span>
                {controller.networkStatus?.proxyAddress ? (
                  <code>{controller.networkStatus.proxyAddress}</code>
                ) : null}
              </div>
              <label>
                <span>指定 HTTP(S) 代理（可选）</span>
                <input
                  type="url"
                  value={proxyInput}
                  placeholder="例如 http://127.0.0.1:7897"
                  disabled={previewMode || busyAction !== null || !status.configured}
                  onChange={(event) => setProxyInput(event.target.value)}
                />
              </label>
              <div className="local-resource-location-actions">
                <button
                  className="button quiet"
                  type="button"
                  disabled={
                    previewMode ||
                    busyAction !== null ||
                    !status.configured ||
                    proxyInput.trim().length === 0
                  }
                  onClick={() => void applyProxy(proxyInput.trim())}
                >
                  {busyAction === "proxy" ? "正在保存…" : "使用指定代理"}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={previewMode || busyAction !== null || !status.configured}
                  onClick={() => void applyProxy(null)}
                >
                  恢复自动设置
                </button>
              </div>
            </section>
            {diagnostics ? (
              <div className="notice" role="status">
                <strong>当前使用内置可信目录清单</strong>
                <p>
                  远程目录尚未启用；只有完成独立 Ed25519 签名、过期时间和防回滚验证后才会开放。
                </p>
              </div>
            ) : (
              <div className="local-resources-loading" role="status">
                <span className="spinner" />
                <span>正在读取版本与健康状态…</span>
              </div>
            )}
            <div className="local-resource-diagnostic-list">
              {catalog.resources.map((resource) => {
                const diagnostic = diagnostics?.resources.find(
                  (item) => item.id === resource.id,
                );
                return (
                  <article key={resource.id}>
                  <div>
                    <strong>{resource.id}</strong>
                    <span>
                      {diagnostic?.activeVersion
                        ? `当前 ${diagnostic.activeVersion}`
                        : `目录 ${resource.version}`}
                    </span>
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
                  {diagnostic?.artifactUrl ? (
                    <code title={diagnostic.artifactUrl}>
                      下载地址 {diagnostic.artifactUrl}
                    </code>
                  ) : null}
                  <a href={resource.sourcePage} target="_blank" rel="noreferrer">
                    查看来源与许可说明
                  </a>
                  {diagnostic?.versions.map((version) => (
                    <div className="local-resource-version" key={version.version}>
                      <div>
                        <strong>
                          {version.version}
                          {version.active ? "（活动）" : ""}
                        </strong>
                        <span>
                          {formatBytes(version.installedBytes)} · {version.fileCount} 个文件 ·
                          {version.entrypointsAvailable ? " 入口可用" : " 入口缺失"} ·
                          {` 健康检查 ${version.healthStatus}`}
                        </span>
                      </div>
                      <code>路径 {version.installPath}</code>
                      <code>清单 {version.manifestSha256}</code>
                      {!version.active && version.entrypointsAvailable ? (
                        <button
                          className="button quiet"
                          type="button"
                          disabled={previewMode || busyAction !== null}
                          onClick={() =>
                            void rollbackResource(resource.id, version.version)
                          }
                        >
                          回退到 {version.version}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {diagnostic?.state === "update_available" && resource.artifact ? (
                    <button
                      className="button quiet"
                      type="button"
                      disabled={busyAction !== null || previewMode}
                      onClick={() => void updateResource(resource.id)}
                    >
                      更新 {resource.id}
                    </button>
                  ) : null}
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
                );
              })}
            </div>
            {diagnostics && diagnostics.tasks.length > 0 ? (
              <section className="local-resource-task-diagnostics">
                <strong>下载与安装任务</strong>
                {diagnostics.tasks.map((task) => (
                  <div key={task.id}>
                    <span>
                      {task.resourceId} · {task.version} · {task.state} ·
                      {` ${formatBytes(task.downloadedBytes)} / ${formatBytes(
                        task.totalBytes,
                      )}`}
                    </span>
                    {task.errorCode || task.errorMessage ? (
                      <code>
                        {task.errorCode ?? "未分类"}
                        {task.errorMessage ? `：${task.errorMessage}` : ""}
                      </code>
                    ) : null}
                  </div>
                ))}
              </section>
            ) : null}
            <div className="local-resource-location-actions">
              <button
                className="button quiet"
                type="button"
                disabled={previewMode || busyAction !== null}
                onClick={() => void copyDiagnosticSummary()}
              >
                {busyAction === "copy-diagnostics" ? "正在复制…" : "复制脱敏诊断摘要"}
              </button>
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
              <button
                className="button quiet"
                type="button"
                disabled={previewMode || busyAction !== null}
                onClick={() => void inspectOldVersionCleanup()}
              >
                {busyAction === "plan-old-version-cleanup"
                  ? "正在计算…"
                  : "检查旧资源版本"}
              </button>
              {oldVersionCleanupPlan && oldVersionCleanupPlan.candidates.length > 0 ? (
                <button
                  className="text-button danger"
                  type="button"
                  disabled={previewMode || busyAction !== null}
                  onClick={() => void confirmOldVersionCleanup()}
                >
                  {busyAction === "cleanup-old-versions"
                    ? "正在清理…"
                    : `清理旧版本 ${formatBytes(
                        oldVersionCleanupPlan.reclaimableBytes,
                      )}`}
                </button>
              ) : null}
            </div>
            {thirdPartyNotices ? (
              <details className="local-resource-license-notices">
                <summary>查看完整第三方许可说明</summary>
                <pre>{thirdPartyNotices}</pre>
              </details>
            ) : null}
          </details>
        ) : null}
      </div>
  );
  return embedded ? content : (
    <Dialog
      title={firstRun ? "准备 SiaoVPlay" : "本地功能资源"}
      eyebrow={pendingAction ? "继续上一步操作" : "按需下载 · 本机保存"}
      onClose={onClose}
      actions={<button className="button quiet" type="button" onClick={onClose}>
        {pendingAction ? "取消此次操作" : "完成"}
      </button>}
    >
      {content}
    </Dialog>
  );
}
