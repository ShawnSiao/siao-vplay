import { useEffect, useRef, useState } from "react";
import type { SubtitleVersion, TranslationTask } from "../../types";

// Result delivery is a local read, separate from the already completed AI task.
// Callback identity changes must not cause automatic retry or duplicate delivery.
export function useTranslationResultRead(
  task: TranslationTask | null,
  versions: SubtitleVersion[],
  onCompleted: (task: TranslationTask) => Promise<void>,
) {
  const delivery = useRef({ task, onCompleted });
  useEffect(() => { delivery.current = { task, onCompleted }; }, [task, onCompleted]);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const key = task?.status === "completed" ? `${task.projectId}:${task.id}:${task.outputVersionId}` : null;
  const available = Boolean(task?.outputVersionId && versions.some((item) => item.id === task.outputVersionId));
  useEffect(() => {
    const current = delivery.current;
    if (!key || !current.task || available) return;
    const completed = current.task;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setFailure(null);
      return current.onCompleted(completed);
    }).catch(() => {
      if (active) setFailure(key);
    });
    return () => { active = false; };
  }, [key, available, attempt]);
  return {
    failed: !available && key !== null && failure === key,
    retry: () => { setFailure(null); setAttempt((value) => value + 1); },
  };
}
