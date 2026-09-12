import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { cancelStorageMigration } from "./gateway";
import type { StorageMigrationTask } from "./types";

type Request = { task: StorageMigrationTask };
const matches = (left: StorageMigrationTask | null, right: StorageMigrationTask) => left?.id === right.id &&
  left.area === right.area && left.mode === right.mode && left.sourceRoot === right.sourceRoot && left.destinationRoot === right.destinationRoot;

export function useStorageMigrationCancellation(task: StorageMigrationTask | null, previewMode: boolean,
  setTask: Dispatch<SetStateAction<StorageMigrationTask | null>>, onError: (cause: unknown) => void) {
  const owner = useRef<Request | null>(null);
  const [pending, setPending] = useState<Request | null>(null);
  const errorRef = useRef(onError);
  useLayoutEffect(() => { errorRef.current = onError; }, [onError]);
  useLayoutEffect(() => {
    if (owner.current && (!matches(task, owner.current.task) || task?.status !== "running")) {
      owner.current = null;
      setPending(null);
    }
  }, [task]);
  useLayoutEffect(() => () => { owner.current = null; }, []);
  const cancel = useCallback(async () => {
    if (previewMode || !task || task.status !== "running" || owner.current) return;
    const request = { task };
    owner.current = request;
    setPending(request);
    try {
      const next = await cancelStorageMigration(task.id);
      if (owner.current !== request) return;
      if (!matches(next, task)) throw new Error("取消回执与当前迁移任务或目录不匹配，请重新读取迁移状态。");
      setTask(current => matches(current, task) && current?.status === "running" ? next : current);
    } catch (cause) {
      if (owner.current !== request) return;
      owner.current = null;
      setPending(null);
      errorRef.current(cause);
    }
  }, [previewMode, setTask, task]);
  return { cancel, cancelling: pending !== null && matches(task, pending.task) && task?.status === "running" };
}
