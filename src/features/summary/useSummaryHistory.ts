import { useCallback, useEffect, useState } from "react";
import { commandError } from "../../lib/commandError";
import { listSummaryTasks, listVideoSummaries } from "./gateway";
import type { SummaryTask, VideoSummary } from "./types";

type Loaded = (tasks: SummaryTask[], summaries: VideoSummary[]) => void;
type ReadState = { projectId: string; attempt: number; error: string | null };

export function useSummaryHistory(projectId: string, onLoaded: Loaded) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<ReadState | null>(null);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let active = true;
    void Promise.all([listSummaryTasks(projectId), listVideoSummaries(projectId)])
      .then(([tasks, summaries]) => {
        if (!active) return;
        onLoaded(tasks, summaries);
        setSettled({ projectId, attempt, error: null });
      }).catch(cause => {
        if (active) setSettled({ projectId, attempt, error: commandError(cause).message });
      });
    return () => { active = false; };
  }, [projectId, attempt, onLoaded]);
  const current = settled?.projectId === projectId && settled.attempt === attempt ? settled : null;
  return { loading: current === null, error: current?.error ?? null, retry };
}
