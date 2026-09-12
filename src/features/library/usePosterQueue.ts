import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { ensureProjectPoster } from "../../lib/desktop";
import type { LibraryMediaSummary, Project } from "../../types";

const refreshBatchSize = 4;
const queueDelayMs = 300;

type PosterQueueOptions = {
  enabled: boolean;
  media: LibraryMediaSummary[];
  refreshLibrary: () => Promise<unknown> | unknown;
  setActiveProject: Dispatch<SetStateAction<Project | null>>;
};

export function usePosterQueue({
  enabled,
  media,
  refreshLibrary,
  setActiveProject,
}: PosterQueueOptions) {
  const busyRef = useRef(false);
  const completedRef = useRef(new Set<string>());
  const enabledRef = useRef(enabled);
  const failuresRef = useRef(new Set<string>());
  const timerRef = useRef<number | null>(null);
  const refreshPendingRef = useRef(0);
  const [queueTick, setQueueTick] = useState(0);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled && timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [enabled]);

  useEffect(
    () => () => {
      enabledRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!enabled || busyRef.current) return;
    const key = (candidate: LibraryMediaSummary) => `${candidate.projectId}:${candidate.mediaLocator}`;
    const project = media.find((candidate) => candidate.mediaAvailable && candidate.durationMs !== null &&
      !candidate.posterPath && !failuresRef.current.has(key(candidate)) && !completedRef.current.has(key(candidate)));
    if (!project) {
      if (refreshPendingRef.current > 0) {
        refreshPendingRef.current = 0;
        void refreshLibrary();
      }
      return;
    }

    busyRef.current = true;
    void ensureProjectPoster(project.projectId)
      .then((updated) => {
        if (updated.id !== project.projectId) throw new Error("Poster response project mismatch");
        completedRef.current.add(key(project));
        setActiveProject((current) => current?.id === updated.id &&
          current.mediaSource.locator === project.mediaLocator && updated.mediaSource.locator === project.mediaLocator
          ? { ...current, mediaSource: { ...current.mediaSource, posterPath: updated.mediaSource.posterPath } } : current);
        refreshPendingRef.current += 1;
        if (enabledRef.current && refreshPendingRef.current >= refreshBatchSize) {
          refreshPendingRef.current = 0;
          void refreshLibrary();
        }
      })
      .catch(() => failuresRef.current.add(key(project)))
      .finally(() => {
        busyRef.current = false;
        if (enabledRef.current) {
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setQueueTick((tick) => tick + 1);
          }, queueDelayMs);
        }
      });
  }, [enabled, media, queueTick, refreshLibrary, setActiveProject]);
}
