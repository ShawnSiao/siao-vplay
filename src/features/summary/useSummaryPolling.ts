import { useEffect, useLayoutEffect, useRef } from "react";
import type { SummaryTask } from "./types";
type Options = {
  projectId: string;
  task: SummaryTask | null;
  read: (taskId: string) => Promise<SummaryTask>;
  onTask: (task: SummaryTask) => void;
  onError: (cause: unknown) => void;
};
const pollingStatuses = new Set(["queued", "running", "validating"]);
export function useSummaryPolling({ projectId, task, read, onTask, onError }: Options) {
  const latest = useRef({ onTask, onError });
  useLayoutEffect(() => { latest.current = { onTask, onError }; }, [onTask, onError]);
  const taskId = task?.projectId === projectId && pollingStatuses.has(task.status) ? task.id : null;
  useEffect(() => {
    if (!taskId) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      let again = true;
      try {
        const next = await read(taskId);
        if (!active) return;
        if (next.id !== taskId || next.projectId !== projectId) throw new Error("总结任务与当前视频不匹配，未采用返回状态。");
        again = pollingStatuses.has(next.status);
        latest.current.onTask(next);
      } catch (cause) {
        if (active) latest.current.onError(cause);
      }
      if (active && again) timer = window.setTimeout(() => void poll(), 900);
    };
    timer = window.setTimeout(() => void poll(), 900);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [projectId, taskId, read]);
}
