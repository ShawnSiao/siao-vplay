import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SubtitleVersion, TranscriptionJob } from "../../types";
import { matchesTranscriptionOutput } from "../playback/transcriptionCompletion";
type Options = { projectId: string; job: TranscriptionJob | null; read: (projectId: string, versionId: string) => Promise<SubtitleVersion>; onResult: (version: SubtitleVersion) => void };
export function useTranscriptionResult({ projectId, job, read, onResult }: Options) {
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{ identity: string; attempt: number; error: unknown } | null>(null);
  const callback = useRef(onResult);
  useLayoutEffect(() => { callback.current = onResult; }, [onResult]);
  const completed = job?.projectId === projectId && job.status === "completed";
  const versionId = completed ? job.subtitleVersionId : null;
  const identity = completed ? JSON.stringify([projectId, job.id, versionId]) : null;
  useEffect(() => {
    if (!identity) return;
    let active = true;
    void (async () => {
      try {
        if (!versionId) throw new Error("字幕任务已完成，但缺少生成版本标识。");
        const version = await read(projectId, versionId);
        if (!active) return;
        if (!matchesTranscriptionOutput(version, versionId, projectId)) throw new Error("生成的字幕与当前任务不匹配，未采用结果。");
        callback.current(version);
        setOutcome({ identity, attempt, error: null });
      } catch (error) { if (active) setOutcome({ identity, attempt, error }); }
    })();
    return () => { active = false; };
  }, [identity, versionId, projectId, attempt, read]);
  const settled = outcome?.identity === identity && outcome.attempt === attempt;
  return { error: settled ? outcome.error : null, loading: identity !== null && !settled, retry: () => setAttempt(value => value + 1) };
}
