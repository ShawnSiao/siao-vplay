import { useEffect, useRef, useState } from "react";
import { commandError } from "../../lib/desktop";
import type { LearningTask } from "../../types";
import type { LearningContext } from "./learningContext";
import { readLearningTaskContext } from "./learningTaskContext";

type RecoveryState = { taskId: string; ready: boolean; error: string | null };

export function useLearningTaskContext(
  task: LearningTask | null,
  context: LearningContext,
  onRestore: (context: LearningContext, selectedText: string) => void,
) {
  const latest = useRef({ task, context, onRestore });
  useEffect(() => { latest.current = { task, context, onRestore }; }, [task, context, onRestore]);
  const [state, setState] = useState<RecoveryState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const taskId = task?.id ?? null;
  useEffect(() => {
    const { task, context } = latest.current;
    if (!task) { setState(null); return; }
    let active = true;
    setState({ taskId: task.id, ready: false, error: null });
    void readLearningTaskContext(task, context).then((recovered) => {
      if (!active) return;
      latest.current.onRestore(recovered, task.selectedText);
      setState({ taskId: task.id, ready: true, error: null });
    }).catch((cause: unknown) => {
      if (active) setState({ taskId: task.id, ready: false, error: commandError(cause).message });
    });
    return () => { active = false; };
    // Task context is immutable for its identity; progress updates must not reload it.
  }, [taskId, attempt]);
  return {
    blocked: Boolean(task && (state?.taskId !== task.id || !state.ready)),
    error: state?.taskId === taskId ? state?.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
