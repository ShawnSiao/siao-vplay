import { useCallback, useRef, useState } from "react";
import type { ResourceDownloadSnapshot, ResourceDownloadTask } from "../../types";
export type ResourceTaskMetric = { bytesPerSecond: number; remainingSeconds: number | null };
type Observation = { bytes: number; sampledAtMs: number; bytesPerSecond: number; attempt: number };

// A store only adds tasks within a binding generation; removing/rebinding a root advances it.
export function mergeResourceSnapshot(current: ResourceDownloadSnapshot, incoming: ResourceDownloadSnapshot): ResourceDownloadSnapshot {
  if (incoming.generation < current.generation) return current;
  const reset = incoming.generation > current.generation;
  const tasks = new Map((reset ? [] : current.tasks).map(task => [task.id, task]));
  let changed = reset;
  for (const task of incoming.tasks) {
    const previous = tasks.get(task.id);
    if (!previous || task.revision > previous.revision) { tasks.set(task.id, task); changed = true; }
  }
  return changed ? { generation: incoming.generation, tasks: [...tasks.values()].sort((a, b) => b.createdAtMs - a.createdAtMs) } : current;
}

export function useResourceTaskState() {
  const snapshot = useRef<ResourceDownloadSnapshot>({ generation: 0, tasks: [] });
  const observations = useRef(new Map<string, Observation>());
  const metrics = useRef<Record<string, ResourceTaskMetric>>({});
  const [view, setView] = useState<{ tasks: ResourceDownloadTask[]; taskMetrics: Record<string, ResourceTaskMetric> }>({ tasks: [], taskMetrics: {} });
  const adoptSnapshot = useCallback((incoming: ResourceDownloadSnapshot) => {
    const previous = snapshot.current;
    const next = mergeResourceSnapshot(previous, incoming);
    if (next === previous) return false;
    if (next.generation !== previous.generation) { observations.current.clear(); metrics.current = {}; }
    const previousTasks = new Map(previous.tasks.map(task => [task.id, task]));
    const nextMetrics = { ...metrics.current };
    for (const task of next.tasks) {
      if (previousTasks.get(task.id) === task) continue;
      const sampledAtMs = Date.now();
      const old = observations.current.get(task.id);
      let bytesPerSecond = old?.attempt === task.attempt ? old.bytesPerSecond : 0;
      if (old && old.attempt === task.attempt && task.state === "downloading" && task.downloadedBytes >= old.bytes) {
        const elapsedMs = sampledAtMs - old.sampledAtMs;
        const delta = task.downloadedBytes - old.bytes;
        if (elapsedMs > 0 && delta > 0) {
          const speed = delta * 1000 / elapsedMs;
          bytesPerSecond = bytesPerSecond > 0 ? bytesPerSecond * 0.65 + speed * 0.35 : speed;
        }
      }
      if (task.state !== "downloading") bytesPerSecond = 0;
      observations.current.set(task.id, { bytes: task.downloadedBytes, sampledAtMs, bytesPerSecond, attempt: task.attempt });
      nextMetrics[task.id] = { bytesPerSecond, remainingSeconds: bytesPerSecond > 0 ? Math.max(0, task.totalBytes - task.downloadedBytes) / bytesPerSecond : null };
    }
    snapshot.current = next; metrics.current = nextMetrics;
    setView({ tasks: next.tasks, taskMetrics: nextMetrics });
    return true;
  }, []);
  const mergeTask = useCallback((task: ResourceDownloadTask) => adoptSnapshot({ generation: task.generation, tasks: [task] }), [adoptSnapshot]);
  return { ...view, mergeTask, adoptSnapshot };
}
