import { useEffect, useLayoutEffect, useRef } from "react";
import { getLocalResourceStatus, listResourceDownloadTasks } from "../../lib/desktop";
import type { LocalResourceStatus, ResourceDownloadSnapshot } from "../../types";

type Options = {
  enabled: boolean;
  beginRead?: () => (cause?: unknown) => void;
  onSnapshot: (tasks: ResourceDownloadSnapshot, status: LocalResourceStatus) => void;
  onError: (cause: unknown) => void;
};
export function useResourcePolling({ enabled, onSnapshot, onError, beginRead }: Options) {
  const latest = useRef({ onSnapshot, onError, beginRead });
  useLayoutEffect(() => { latest.current = { onSnapshot, onError, beginRead }; }, [onSnapshot, onError, beginRead]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      const finishRead = latest.current.beginRead?.();
      try {
        const [tasks, status] = await Promise.allSettled([listResourceDownloadTasks(), getLocalResourceStatus()]);
        if (!active) return;
        if (tasks.status === "rejected") throw tasks.reason;
        if (status.status === "rejected") throw status.reason;
        latest.current.onSnapshot(tasks.value, status.value);
        finishRead?.();
      } catch (cause) {
        if (active) {
          if (finishRead) finishRead(cause);
          else latest.current.onError(cause);
        }
      }
      if (active) timer = window.setTimeout(() => void poll(), 1_000);
    };
    timer = window.setTimeout(() => void poll(), 1_000);
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [enabled]);
}
