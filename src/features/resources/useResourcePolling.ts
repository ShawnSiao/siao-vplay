import { useEffect, useLayoutEffect, useRef } from "react";
import { getLocalResourceStatus, listResourceDownloadTasks } from "../../lib/desktop";
import type { LocalResourceStatus, ResourceDownloadTask } from "../../types";

type Options = {
  enabled: boolean;
  onSnapshot: (tasks: ResourceDownloadTask[], status: LocalResourceStatus) => void;
  onError: (cause: unknown) => void;
};
export function useResourcePolling({ enabled, onSnapshot, onError }: Options) {
  const latest = useRef({ onSnapshot, onError });
  useLayoutEffect(() => { latest.current = { onSnapshot, onError }; }, [onSnapshot, onError]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const [tasks, status] = await Promise.allSettled([listResourceDownloadTasks(), getLocalResourceStatus()]);
        if (!active) return;
        if (tasks.status === "rejected") throw tasks.reason;
        if (status.status === "rejected") throw status.reason;
        latest.current.onSnapshot(tasks.value, status.value);
      } catch (cause) {
        if (active) latest.current.onError(cause);
      }
      if (active) timer = window.setTimeout(() => void poll(), 1_000);
    };
    timer = window.setTimeout(() => void poll(), 1_000);
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [enabled]);
}
