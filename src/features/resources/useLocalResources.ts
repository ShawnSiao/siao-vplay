import { commandError } from "../../lib/commandError";
import { useCallback, useEffect, useRef, useState } from "react";
import { useResourceNetworkState } from "./useResourceNetworkState";
import { useResourceFeedback } from "./useResourceFeedback";
import { useResourceStatusState } from "./useResourceStatusState";
import { useResourceMove } from "./useResourceMove";
import { useResourceTaskState, type ResourceTaskMetric } from "./useResourceTaskState";
export type { ResourceTaskMetric } from "./useResourceTaskState";
import { useResourcePolling } from "./useResourcePolling";

import {
  adoptLocalResources,
  cancelResourceDownload,
  chooseLocalResourceParent,
  cleanupUnusedResources,
  configureLocalResourceRoot,
  getLocalResourceCatalog,
  getLocalResourceDiagnostics,
  getLocalResourceDiagnosticSummary,
  getLocalResourceNetworkStatus,
  getLocalResourceStatus,
  getLocalResourceThirdPartyNotices,
  inspectLocalResourceMigration,
  listenResourceDownloadTasks,
  listResourceDownloadTasks,
  pauseResourceDownload,
  planLocalResourceMove,
  planLocalResourceLocation,
  planUnusedResourceCleanup,
  planOldResourceVersionCleanup,
  prepareLocalCapability,
  removeLocalResource,
  reconnectLocalResourceRoot,
  repairLocalResource,
  repairLocalResourceRoot,
  rollbackLocalResource,
  resumeResourceDownload,
  retryResourceDownload,
  setLocalResourceProfile,
  setLocalResourceProxy,
  updateLocalResource,
  cleanupOldResourceVersions,
} from "../../lib/desktop";
import type {
  CapabilityPreparation,
  LocalResourceCatalog,
  LocalResourceLocationPlan,
  LocalResourceMovePlan,
  LocalResourceMoveResult,
  LocalResourceDiagnostics,
  LocalResourceStatus,
  ResourceAdoptionResult,
  ResourceDownloadTask,
  ResourceNetworkStatus,
  ResourceMigrationPreview,
  ResourceRemovalResult,
  ResourceRollbackResult,
  OldResourceVersionCleanupPlan,
  OldResourceVersionCleanupResult,
  UnusedResourceCleanupPlan,
  UnusedResourceCleanupResult,
} from "../../types";

const activeTaskStates = new Set<ResourceDownloadTask["state"]>([
  "queued",
  "downloading",
  "verifying",
  "installing",
]);

export type LocalResourcesController = {
  catalog: LocalResourceCatalog | null;
  status: LocalResourceStatus | null;
  tasks: ResourceDownloadTask[];
  taskMetrics: Record<string, ResourceTaskMetric>;
  networkStatus: ResourceNetworkStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<LocalResourceStatus>;
  clearError: () => void;
  chooseLocation: () => Promise<LocalResourceLocationPlan | null>;
  confirmLocation: (parentPath: string) => Promise<LocalResourceStatus>;
  chooseExistingResources: () => Promise<{
    sourcePath: string;
    preview: ResourceMigrationPreview;
  } | null>;
  adoptResources: (sourcePath?: string) => Promise<ResourceAdoptionResult>;
  chooseMoveLocation: () => Promise<LocalResourceMovePlan | null>;
  moveLocation: (parentPath: string) => Promise<LocalResourceMoveResult>;
  moving?: boolean;
  cancellingMove?: boolean;
  cancelMove?: () => Promise<boolean>;
  repairRoot: () => Promise<LocalResourceStatus>;
  reconnectRoot: () => Promise<LocalResourceStatus | null>;
  planCleanup: () => Promise<UnusedResourceCleanupPlan>;
  cleanupUnused: (planFingerprint: string) => Promise<UnusedResourceCleanupResult>;
  loadDiagnostics: () => Promise<{
    diagnostics: LocalResourceDiagnostics;
    thirdPartyNotices: string;
  }>;
  diagnosticSummary: () => Promise<string>;
  updateResource: (resourceId: string) => Promise<ResourceDownloadTask>;
  rollbackResource: (
    resourceId: string,
    version: string,
  ) => Promise<ResourceRollbackResult>;
  planOldVersionCleanup: () => Promise<OldResourceVersionCleanupPlan>;
  cleanupOldVersions: (planFingerprint: string) => Promise<OldResourceVersionCleanupResult>;
  selectProfile: (profileId: string) => Promise<LocalResourceStatus>;
  setProxy: (proxyUrl: string | null) => Promise<ResourceNetworkStatus>;
  prepareCapability: (
    capabilityId: string,
    pendingActionId?: string,
  ) => Promise<CapabilityPreparation>;
  pauseTask: (taskId: string) => Promise<ResourceDownloadTask>;
  resumeTask: (taskId: string) => Promise<ResourceDownloadTask>;
  cancelTask: (taskId: string) => Promise<ResourceDownloadTask>;
  retryTask: (taskId: string) => Promise<ResourceDownloadTask>;
  repairResource: (resourceId: string) => Promise<ResourceDownloadTask>;
  removeResource: (
    resourceId: string,
    confirmed: boolean,
  ) => Promise<ResourceRemovalResult>;
};

export function useLocalResources(): LocalResourcesController {
  const [catalog, setCatalog] = useState<LocalResourceCatalog | null>(null);
  const { status, setStatus } = useResourceStatusState();
  const { tasks, taskMetrics, mergeTask, adoptSnapshot } = useResourceTaskState();
  const { networkStatus, setNetworkStatus, networkRevision, invalidateNetwork } = useResourceNetworkState();
  const [loading, setLoading] = useState(true);
  const { error, setError, captureError, beginRead } = useResourceFeedback();
  const initializedRef = useRef(false);
  const refreshAttempt = useRef(0);
  const proxyAttempt = useRef(0);
  useEffect(() => () => { refreshAttempt.current++; }, []);

  const resourceMove = useResourceMove(async () => {
    setStatus(await getLocalResourceStatus());
    adoptSnapshot(await listResourceDownloadTasks());
    setError(null);
  }, captureError);

  const refresh = useCallback(async () => {
    const attempt = ++refreshAttempt.current;
    const finishRead = beginRead("refresh");
    const observedNetworkRevision = networkRevision();
    if (!initializedRef.current) {
      setLoading(true);
    }
    try {
      const [nextCatalog, nextStatus, nextTasks, nextNetworkStatus] = await Promise.all([
        getLocalResourceCatalog(),
        getLocalResourceStatus(),
        listResourceDownloadTasks(),
        getLocalResourceNetworkStatus().then(
          value => ({ ok: true as const, value }),
          cause => ({ ok: false as const, cause }),
        ),
      ]);
      if (attempt === refreshAttempt.current) setCatalog(nextCatalog);
      setStatus(nextStatus);
      adoptSnapshot(nextTasks);
      if (nextNetworkStatus.ok) setNetworkStatus(nextNetworkStatus.value);
      else invalidateNetwork(observedNetworkRevision);
      finishRead(nextNetworkStatus.ok ? undefined : nextNetworkStatus.cause);
      initializedRef.current = true;
      return setStatus(nextStatus);
    } catch (cause) {
      finishRead(cause);
      throw cause;
    } finally {
      if (attempt === refreshAttempt.current) setLoading(false);
    }
  }, [beginRead, adoptSnapshot, setStatus, networkRevision, setNetworkStatus, invalidateNetwork]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listenResourceDownloadTasks((task) => {
      if (!active) {
        return;
      }
      if (!mergeTask(task)) return;
      if (["completed", "failed", "cancelled"].includes(task.state)) {
        const finishRead = beginRead("terminal");
        void getLocalResourceStatus()
          .then((nextStatus) => {
            if (active) {
              setStatus(nextStatus);
              finishRead();
            }
          })
          .catch(cause => { if (active) finishRead(cause); });
      }
    }, cause => { if (active) captureError(cause); })
      .then((stop) => {
        if (active) {
          unlisten = stop;
        } else {
          stop();
        }
      })
      .catch(cause => { if (active) captureError(cause); });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [beginRead, captureError, mergeTask, setStatus]);

  useResourcePolling({
    enabled: tasks.some((task) => activeTaskStates.has(task.state)),
    onSnapshot: (nextTasks, nextStatus) => {
      adoptSnapshot(nextTasks);
      setStatus(nextStatus);
    },
    onError: captureError,
    beginRead: () => beginRead("poll"),
  });

  const updateTask = useCallback(
    async (
      operation: () => Promise<ResourceDownloadTask>,
    ): Promise<ResourceDownloadTask> => {
      try {
        const task = await operation();
        mergeTask(task);
        setError(null);
        return task;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    [captureError, mergeTask, setError],
  );

  async function cleanupResources<T>(operation: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await operation();
    } catch (cause) {
      captureError(cause);
      throw cause;
    }
    setError(null);
    const finishRead = beginRead("refresh");
    try {
      setStatus(await getLocalResourceStatus());
      finishRead();
    } catch (cause) {
      finishRead(new Error(`清理结果已保留，资源状态刷新失败：${commandError(cause).message}`));
    }
    return result;
  }

  return {
    catalog,
    status,
    tasks,
    taskMetrics,
    networkStatus,
    loading,
    error,
    refresh,
    clearError: () => setError(null),
    chooseLocation: async () => {
      try {
        const parentPath = await chooseLocalResourceParent();
        if (!parentPath) {
          return null;
        }
        const plan = await planLocalResourceLocation(parentPath);
        setError(null);
        return plan;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    confirmLocation: async (parentPath) => {
      try {
        const nextStatus = await configureLocalResourceRoot(parentPath, true);
        setStatus(nextStatus);
        setError(null);
        return setStatus(nextStatus);
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    chooseExistingResources: async () => {
      try {
        const sourcePath = await chooseLocalResourceParent();
        if (!sourcePath) {
          return null;
        }
        const preview = await inspectLocalResourceMigration(sourcePath);
        setError(null);
        return { sourcePath, preview };
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    adoptResources: async (sourcePath) => {
      try {
        const result = await adoptLocalResources(sourcePath);
        setStatus(await getLocalResourceStatus());
        setError(null);
        return result;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    chooseMoveLocation: async () => {
      try {
        const parentPath = await chooseLocalResourceParent();
        if (!parentPath) {
          return null;
        }
        const plan = await planLocalResourceMove(parentPath);
        setError(null);
        return plan;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    moving: resourceMove.moving,
    cancellingMove: resourceMove.cancelling,
    cancelMove: resourceMove.cancel,
    moveLocation: resourceMove.move,
    repairRoot: async () => {
      try {
        const nextStatus = await repairLocalResourceRoot();
        setStatus(nextStatus);
        adoptSnapshot(await listResourceDownloadTasks());
        setError(null);
        return setStatus(nextStatus);
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    reconnectRoot: async () => {
      try {
        const parentPath = await chooseLocalResourceParent();
        if (!parentPath) {
          return null;
        }
        const nextStatus = await reconnectLocalResourceRoot(parentPath);
        setStatus(nextStatus);
        adoptSnapshot(await listResourceDownloadTasks());
        setError(null);
        return setStatus(nextStatus);
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    planCleanup: async () => {
      try {
        const plan = await planUnusedResourceCleanup();
        setError(null);
        return plan;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    cleanupUnused: (planFingerprint) => cleanupResources(() => cleanupUnusedResources(planFingerprint)),
    loadDiagnostics: async () => {
      const finishRead = beginRead("diagnostics");
      try {
        const [diagnostics, thirdPartyNotices] = await Promise.all([
          getLocalResourceDiagnostics(),
          getLocalResourceThirdPartyNotices(),
        ]);
        finishRead();
        return { diagnostics, thirdPartyNotices };
      } catch (cause) {
        finishRead(cause);
        throw cause;
      }
    },
    diagnosticSummary: async () => {
      try {
        const summary = await getLocalResourceDiagnosticSummary();
        setError(null);
        return summary;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    updateResource: (resourceId) =>
      updateTask(() => updateLocalResource(resourceId)),
    rollbackResource: async (resourceId, version) => {
      try {
        const result = await rollbackLocalResource(resourceId, version);
        setStatus(await getLocalResourceStatus());
        setError(null);
        return result;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    planOldVersionCleanup: async () => {
      try {
        const plan = await planOldResourceVersionCleanup();
        setError(null);
        return plan;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    cleanupOldVersions: (planFingerprint) => cleanupResources(() => cleanupOldResourceVersions(planFingerprint)),
    selectProfile: async (profileId) => {
      try {
        const nextStatus = await setLocalResourceProfile(profileId);
        setStatus(nextStatus);
        setError(null);
        return setStatus(nextStatus);
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    setProxy: async (proxyUrl) => {
      const attempt = ++proxyAttempt.current;
      try {
        const nextStatus = await setLocalResourceProxy(proxyUrl);
        const accepted = setNetworkStatus(nextStatus);
        if (attempt === proxyAttempt.current) setError(null);
        return accepted;
      } catch (cause) {
        if (attempt === proxyAttempt.current) captureError(cause);
        throw cause;
      }
    },
    prepareCapability: async (capabilityId, pendingActionId) => {
      try {
        const preparation = await prepareLocalCapability(
          capabilityId,
          pendingActionId,
        );
        const [nextTasks, nextStatus] = await Promise.all([
          listResourceDownloadTasks(),
          getLocalResourceStatus(),
        ]);
        adoptSnapshot(nextTasks);
        setStatus(nextStatus);
        setError(null);
        return preparation;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    pauseTask: (taskId) => updateTask(() => pauseResourceDownload(taskId)),
    resumeTask: (taskId) => updateTask(() => resumeResourceDownload(taskId)),
    cancelTask: (taskId) => updateTask(() => cancelResourceDownload(taskId)),
    retryTask: (taskId) => updateTask(() => retryResourceDownload(taskId)),
    repairResource: (resourceId) =>
      updateTask(() => repairLocalResource(resourceId)),
    removeResource: async (resourceId, confirmed) => {
      try {
        const result = await removeLocalResource(resourceId, confirmed);
        setStatus(await getLocalResourceStatus());
        setError(null);
        return result;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
  };
}
