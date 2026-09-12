import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { beginPlaybackSession, updatePlaybackState } from "../../lib/desktop";
import { PlaybackSaveQueue } from "./playbackSaveQueue";
import type { Project } from "../../types";
import type { PlaybackValues } from "./usePlaybackController";

type Options = {
  project: Project | null;
  sessionId: number;
  currentSession: RefObject<number>;
  setProject: Dispatch<SetStateAction<Project | null>>;
  onFailure: (message: string) => void;
};

export function usePlaybackPersistence({ project, sessionId, currentSession, setProject, onFailure }: Options) {
  const queues = useRef(new PlaybackSaveQueue(beginPlaybackSession));
  const activeId = project?.id;
  useEffect(() => {
    if (activeId) queues.current.activate(activeId, sessionId);
  }, [activeId, sessionId]);
  const failedProjects = useRef(new Set<string>());
  return useCallback(async (values: PlaybackValues) => {
    if (!project) return;
    const projectId = project.id;
    const snapshot = { ...values };
    const save = queues.current.save(projectId, sessionId, async (identity) => {
      const updated = await updatePlaybackState(projectId, { ...snapshot, ...identity });
      if (updated.id !== projectId) throw new Error("Playback response project mismatch");
      failedProjects.current.delete(projectId);
      // A playback response owns only playback state, never title, media or revision.
      const merge = (item: Project) => item.id === projectId
        ? { ...item, playbackState: updated.playbackState } : item;
      if (currentSession.current === sessionId) {
        setProject((current) => current && currentSession.current === sessionId ? merge(current) : current);
      }
    });
    try {
      await save;
    } catch (error) {
      if (!failedProjects.current.has(projectId)) {
        failedProjects.current.add(projectId);
        onFailure(`「${project.title}」的播放位置未能保存。后续保存会重试；关闭应用前请确认磁盘空间与数据目录可用。`);
      }
      throw error;
    }
  }, [project, sessionId, currentSession, setProject, onFailure]);
}
