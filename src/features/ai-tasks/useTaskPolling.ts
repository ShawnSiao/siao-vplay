import { useEffect, useLayoutEffect, useRef } from "react";
type TaskIdentity = { id: string; projectId: string };
type Options<T extends TaskIdentity> = {
  projectId: string; task: T | null; read: (id: string) => Promise<T>;
  onTask: (task: T) => void; onError: (cause: unknown) => void;
  shouldPoll: (task: T) => boolean; intervalMs: number;
};
export { taskPollingIntervals } from "./pollingPolicy";
export function useTaskPolling<T extends TaskIdentity>({ projectId, task, read, onTask, onError, shouldPoll, intervalMs }: Options<T>) {
  const latest = useRef({ onTask, onError });
  useLayoutEffect(() => { latest.current = { onTask, onError }; }, [onTask, onError]);
  const taskId = task?.projectId === projectId && shouldPoll(task) ? task.id : null;
  useEffect(() => {
    if (!taskId) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      let again = true;
      try {
        const next = await read(taskId);
        if (!active) return;
        if (next.id !== taskId || next.projectId !== projectId) throw new Error("返回的任务与当前视频不匹配，未采用状态。");
        again = shouldPoll(next);
        latest.current.onTask(next);
      } catch (cause) {
        if (active) latest.current.onError(cause);
      }
      if (active && again) timer = window.setTimeout(() => void poll(), intervalMs);
    };
    timer = window.setTimeout(() => void poll(), intervalMs);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [projectId, taskId, read, shouldPoll, intervalMs]);
}
