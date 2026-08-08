import { useCallback, useEffect, useRef, useState } from "react";

import {
  adoptLocalResources,
  cancelResourceDownload,
  chooseLocalResourceParent,
  cleanupUnusedResources,
  commandError,
  configureLocalResourceRoot,
  getLocalResourceCatalog,
  getLocalResourceStatus,
  inspectLocalResourceMigration,
  listenResourceDownloadTasks,
  listResourceDownloadTasks,
  pauseResourceDownload,
  planLocalResourceMove,
  planLocalResourceLocation,
  planUnusedResourceCleanup,
  prepareLocalCapability,
  removeLocalResource,
  reconnectLocalResourceRoot,
  repairLocalResource,
  repairLocalResourceRoot,
  resumeResourceDownload,
  retryResourceDownload,
  setLocalResourceProfile,
  moveLocalResourceRoot,
} from "../../lib/desktop";
import type {
  CapabilityPreparation,
  LocalResourceCatalog,
  LocalResourceLocationPlan,
  LocalResourceMovePlan,
  LocalResourceMoveResult,
  LocalResourceStatus,
  ResourceAdoptionResult,
  ResourceDownloadTask,
  ResourceMigrationPreview,
  ResourceRemovalResult,
  UnusedResourceCleanupPlan,
  UnusedResourceCleanupResult,
} from "../../types";

const activeTaskStates = new Set<ResourceDownloadTask["state"]>([
  "queued",
  "downloading",
  "verifying",
  "installing",
]);

export type ResourceTaskMetric = {
  bytesPerSecond: number;
  remainingSeconds: number | null;
};

export type LocalResourcesController = {
  catalog: LocalResourceCatalog | null;
  status: LocalResourceStatus | null;
  tasks: ResourceDownloadTask[];
  taskMetrics: Record<string, ResourceTaskMetric>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<LocalResourceStatus>;
  clearError: () => void;
  chooseLocation: () => Promise<LocalResourceLocationPlan | null>;
  confirmLocation: (parentPath: string) => Promise<LocalResourceStatus>;
  inspectLegacyResources: () => Promise<ResourceMigrationPreview>;
  chooseExistingResources: () => Promise<{
    sourcePath: string;
    preview: ResourceMigrationPreview;
  } | null>;
  adoptResources: (sourcePath?: string) => Promise<ResourceAdoptionResult>;
  chooseMoveLocation: () => Promise<LocalResourceMovePlan | null>;
  moveLocation: (parentPath: string) => Promise<LocalResourceMoveResult>;
  repairRoot: () => Promise<LocalResourceStatus>;
  reconnectRoot: () => Promise<LocalResourceStatus | null>;
  planCleanup: () => Promise<UnusedResourceCleanupPlan>;
  cleanupUnused: () => Promise<UnusedResourceCleanupResult>;
  selectProfile: (profileId: string) => Promise<LocalResourceStatus>;
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

type TaskObservation = {
  bytes: number;
  sampledAtMs: number;
  bytesPerSecond: number;
};

export function useLocalResources(): LocalResourcesController {
  const [catalog, setCatalog] = useState<LocalResourceCatalog | null>(null);
  const [status, setStatus] = useState<LocalResourceStatus | null>(null);
  const [tasks, setTasks] = useState<ResourceDownloadTask[]>([]);
  const [taskMetrics, setTaskMetrics] = useState<
    Record<string, ResourceTaskMetric>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const observationsRef = useRef(new Map<string, TaskObservation>());

  const captureError = useCallback((cause: unknown) => {
    const message = commandError(cause).message;
    setError(message);
    return message;
  }, []);

  const mergeTask = useCallback((nextTask: ResourceDownloadTask) => {
    const sampledAtMs = Date.now();
    const previous = observationsRef.current.get(nextTask.id);
    let bytesPerSecond = previous?.bytesPerSecond ?? 0;
    if (
      previous &&
      nextTask.state === "downloading" &&
      nextTask.downloadedBytes >= previous.bytes
    ) {
      const elapsedMs = sampledAtMs - previous.sampledAtMs;
      const byteDelta = nextTask.downloadedBytes - previous.bytes;
      if (elapsedMs > 0 && byteDelta > 0) {
        const currentSpeed = (byteDelta * 1_000) / elapsedMs;
        bytesPerSecond =
          bytesPerSecond > 0
            ? bytesPerSecond * 0.65 + currentSpeed * 0.35
            : currentSpeed;
      }
    }
    if (nextTask.state !== "downloading") {
      bytesPerSecond = 0;
    }
    observationsRef.current.set(nextTask.id, {
      bytes: nextTask.downloadedBytes,
      sampledAtMs,
      bytesPerSecond,
    });
    const remainingBytes = Math.max(
      0,
      nextTask.totalBytes - nextTask.downloadedBytes,
    );
    setTaskMetrics((current) => ({
      ...current,
      [nextTask.id]: {
        bytesPerSecond,
        remainingSeconds:
          bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : null,
      },
    }));
    setTasks((current) => {
      const next = current.some((task) => task.id === nextTask.id)
        ? current.map((task) =>
            task.id === nextTask.id ? nextTask : task,
          )
        : [...current, nextTask];
      return next.sort((left, right) => right.createdAtMs - left.createdAtMs);
    });
  }, []);

  const replaceTasks = useCallback(
    (nextTasks: ResourceDownloadTask[]) => {
      setTasks([]);
      for (const task of nextTasks) {
        mergeTask(task);
      }
    },
    [mergeTask],
  );

  const refresh = useCallback(async () => {
    if (!initializedRef.current) {
      setLoading(true);
    }
    try {
      const [nextCatalog, nextStatus, nextTasks] = await Promise.all([
        getLocalResourceCatalog(),
        getLocalResourceStatus(),
        listResourceDownloadTasks(),
      ]);
      setCatalog(nextCatalog);
      setStatus(nextStatus);
      replaceTasks(nextTasks);
      setError(null);
      initializedRef.current = true;
      return nextStatus;
    } catch (cause) {
      captureError(cause);
      throw cause;
    } finally {
      setLoading(false);
    }
  }, [captureError, replaceTasks]);

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
      mergeTask(task);
      if (["completed", "failed", "cancelled"].includes(task.state)) {
        void getLocalResourceStatus()
          .then((nextStatus) => {
            if (active) {
              setStatus(nextStatus);
            }
          })
          .catch(captureError);
      }
    })
      .then((stop) => {
        if (active) {
          unlisten = stop;
        } else {
          stop();
        }
      })
      .catch(captureError);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [captureError, mergeTask]);

  useEffect(() => {
    if (!tasks.some((task) => activeTaskStates.has(task.state))) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void Promise.all([
        listResourceDownloadTasks(),
        getLocalResourceStatus(),
      ])
        .then(([nextTasks, nextStatus]) => {
          replaceTasks(nextTasks);
          setStatus(nextStatus);
        })
        .catch(captureError);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [captureError, replaceTasks, tasks]);

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
    [captureError, mergeTask],
  );

  return {
    catalog,
    status,
    tasks,
    taskMetrics,
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
        return nextStatus;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    inspectLegacyResources: async () => {
      try {
        const preview = await inspectLocalResourceMigration();
        setError(null);
        return preview;
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
    moveLocation: async (parentPath) => {
      try {
        const result = await moveLocalResourceRoot(parentPath);
        setStatus(await getLocalResourceStatus());
        replaceTasks(await listResourceDownloadTasks());
        setError(null);
        return result;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    repairRoot: async () => {
      try {
        const nextStatus = await repairLocalResourceRoot();
        setStatus(nextStatus);
        replaceTasks(await listResourceDownloadTasks());
        setError(null);
        return nextStatus;
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
        replaceTasks(await listResourceDownloadTasks());
        setError(null);
        return nextStatus;
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
    cleanupUnused: async () => {
      try {
        const result = await cleanupUnusedResources();
        setStatus(await getLocalResourceStatus());
        setError(null);
        return result;
      } catch (cause) {
        captureError(cause);
        throw cause;
      }
    },
    selectProfile: async (profileId) => {
      try {
        const nextStatus = await setLocalResourceProfile(profileId);
        setStatus(nextStatus);
        setError(null);
        return nextStatus;
      } catch (cause) {
        captureError(cause);
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
        replaceTasks(nextTasks);
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
