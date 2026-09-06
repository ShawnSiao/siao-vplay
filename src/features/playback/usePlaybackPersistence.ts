import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { updatePlaybackState } from "../../lib/desktop";
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
  const queues = useRef(new Map<string, Promise<void>>());
  const latestSessions = useRef(new Map<string, number>());
  const failedProjects = useRef(new Set<string>());
  return useCallback(async (values: PlaybackValues) => {
    if (!project) return;
    const projectId = project.id;
    if ((latestSessions.current.get(projectId) ?? sessionId) > sessionId) return;
    latestSessions.current.set(projectId, sessionId);
    const snapshot = { ...values };
    const previous = queues.current.get(projectId) ?? Promise.resolve();
    const save = previous.then(async () => {
      const updated = await updatePlaybackState(projectId, snapshot);
      if (updated.id !== projectId) throw new Error("Playback response project mismatch");
      failedProjects.current.delete(projectId);
      // A playback response owns only playback state, never title, media or revision.
      const merge = (item: Project) => item.id === projectId
        ? { ...item, playbackState: updated.playbackState } : item;
      if (currentSession.current === sessionId) {
        setProject((current) => current && currentSession.current === sessionId ? merge(current) : current);
      }
    });
    const settled = save.catch(() => undefined);
    queues.current.set(projectId, settled);
    try {
      await save;
    } catch (error) {
      if (!failedProjects.current.has(projectId)) {
        failedProjects.current.add(projectId);
        onFailure(`「${project.title}」的播放位置未能保存。后续保存会重试；关闭应用前请确认磁盘空间与数据目录可用。`);
      }
      throw error;
    } finally {
      if (queues.current.get(projectId) === settled) queues.current.delete(projectId);
    }
  }, [project, sessionId, currentSession, setProject, onFailure]);
}
