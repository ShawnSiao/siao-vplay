import { taskPollingIntervals } from "../ai-tasks/pollingPolicy";
import { useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { getStorageMigration } from "./gateway";
import type { StorageMigrationTask } from "./types";

export function useStorageMigrationPolling(enabled: boolean, task: StorageMigrationTask | null,
  setTask: Dispatch<SetStateAction<StorageMigrationTask | null>>, onError: (cause: unknown) => void) {
  const errorRef = useRef(onError);
  useLayoutEffect(() => { errorRef.current = onError; }, [onError]);
  const id = task?.id;
  const area = task?.area;
  const mode = task?.mode;
  const source = task?.sourceRoot;
  const destination = task?.destinationRoot;
  const running = task?.status === "running";
  useEffect(() => {
    if (!enabled || !running || !id) return;
    let active = true;
    let timer: number | undefined;
    const matches = (value: StorageMigrationTask | null) => value?.id === id && value.area === area &&
      value.mode === mode && value.sourceRoot === source && value.destinationRoot === destination;
    const poll = async () => {
      let again = true;
      try {
        const next = await getStorageMigration(id);
        if (!active) return;
        if (!matches(next)) throw new Error("返回的迁移状态与当前任务或目录不匹配，未采用本次结果。");
        again = next.status === "running";
        setTask(current => matches(current) && current?.status === "running" ? next : current);
      } catch (cause) {
        if (active) errorRef.current(cause);
      }
      if (active && again) timer = window.setTimeout(() => void poll(), taskPollingIntervals.storageMigration);
    };
    timer = window.setTimeout(() => void poll(), taskPollingIntervals.storageMigration);
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [enabled, running, id, area, mode, source, destination, setTask]);
}
