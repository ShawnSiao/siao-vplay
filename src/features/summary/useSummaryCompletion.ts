import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SummaryTask, VideoSummary } from "./types";

type Options = {
  projectId: string;
  task: SummaryTask | null;
  read: (id: string) => Promise<VideoSummary>;
  onResult: (summary: VideoSummary) => void;
};

export function useSummaryCompletion({ projectId, task, read, onResult }: Options) {
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ identity: string | null; attempt: number; cause: unknown } | null>(null);
  const callback = useRef(onResult);
  useLayoutEffect(() => { callback.current = onResult; }, [onResult]);
  const completed = task?.status === "completed" && task.projectId === projectId ? task : null;
  const identity = completed && JSON.stringify([projectId, completed.id, completed.outputSummaryId,
    completed.subtitleVersionId, completed.materialManifestSha256, completed.scope, completed.playbackCutoffMs]);
  const current = useRef(completed);
  useLayoutEffect(() => { current.current = completed; });
  useEffect(() => {
    const expected = current.current;
    if (!expected) return;
    let active = true;
    void (async () => {
      try {
        if (!expected.outputSummaryId) throw new Error("总结已完成，但缺少结果标识。");
        const result = await read(expected.outputSummaryId);
        if (!active) return;
        if (result.id !== expected.outputSummaryId || result.taskId !== expected.id ||
          result.projectId !== expected.projectId || result.subtitleVersionId !== expected.subtitleVersionId ||
          result.materialManifestSha256 !== expected.materialManifestSha256 || result.scope !== expected.scope ||
          result.playbackCutoffMs !== expected.playbackCutoffMs) throw new Error("总结结果与当前任务或发送范围不匹配。");
        callback.current(result);
      } catch (cause) {
        if (active) setFailure({ identity, attempt, cause });
      }
    })();
    return () => { active = false; };
  }, [identity, attempt, read]);
  return { error: failure?.identity === identity && failure.attempt === attempt ? failure.cause : null, retry: () => setAttempt(value => value + 1) };
}
