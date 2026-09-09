import { useEffect, useLayoutEffect, useRef } from "react";
import type { SubtitleVersion, TranscriptionJob } from "../../types";
import { userFacingCommandError } from "../../lib/userFacingError";
import { matchesTranscriptionOutput, transcriptionCompletion } from "./transcriptionCompletion";

type Options = {
  jobId: string | null;
  projectId: string | undefined;
  sessionId: number;
  paused: boolean;
  versions: SubtitleVersion[];
  getTranscriptionJob: (jobId: string) => Promise<TranscriptionJob>;
  getSubtitleVersion: (projectId: string, versionId: string) => Promise<SubtitleVersion>;
  onVersion: (version: SubtitleVersion, message: string, isActive?: () => boolean) => Promise<void>;
  onFinished: (jobId: string) => void;
  onNotice: (message: string) => void;
};

export function useTrackedTranscription({ jobId, projectId, sessionId, paused, versions, getTranscriptionJob, getSubtitleVersion, onVersion, onFinished, onNotice }: Options) {
  const latest = useRef({ versions, onVersion, onFinished, onNotice });
  useLayoutEffect(() => {
    latest.current = { versions, onVersion, onFinished, onNotice };
  }, [versions, onVersion, onFinished, onNotice]);
  useEffect(() => {
    if (
      !jobId ||
      paused ||
      !projectId
    ) {
      return undefined;
    }

    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const job = await getTranscriptionJob(jobId);
        if (!active) {
          return;
        }
        const decision = transcriptionCompletion(job, jobId, projectId);
        if (decision.kind === "waiting") {
          timer = window.setTimeout(() => void poll(), 900);
          return;
        }

        if (decision.kind === "stop") {
          if (decision.notice) latest.current.onNotice(decision.notice);
          latest.current.onFinished(jobId);
          return;
        }
        const version = await getSubtitleVersion(projectId, decision.versionId);
        if (!active) {
          return;
        }
        if (!matchesTranscriptionOutput(version, decision.versionId, projectId)) {
          latest.current.onNotice("返回的字幕版本与任务不匹配，未采用结果。请重新打开字幕工具检查。");
          latest.current.onFinished(jobId);
          return;
        }
        if (!latest.current.versions.some((item) => item.id === version.id)) {
          await latest.current.onVersion(
            version,
            `已生成 ${version.segments.length} 条原文字幕草稿，可以开始抽查。`,
            () => active,
          );
        }
        if (active) latest.current.onFinished(jobId);
      } catch (error) {
        if (active) {
          latest.current.onNotice(userFacingCommandError(error, "subtitle"));
          timer = window.setTimeout(() => void poll(), 1_500);
        }
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [
    projectId,
    sessionId,
    getTranscriptionJob,
    getSubtitleVersion,
    paused,
    jobId,
  ]);

}
