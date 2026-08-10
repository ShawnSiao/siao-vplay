import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { ensureProjectPoster } from "../../lib/desktop";
import type { Project } from "../../types";

const refreshBatchSize = 4;
const queueDelayMs = 300;

type PosterQueueOptions = {
  enabled: boolean;
  projects: Project[];
  refreshLibrary: () => Promise<unknown> | unknown;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setActiveProject: Dispatch<SetStateAction<Project | null>>;
};

export function usePosterQueue({
  enabled,
  projects,
  refreshLibrary,
  setProjects,
  setActiveProject,
}: PosterQueueOptions) {
  const busyRef = useRef(false);
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
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!enabled || busyRef.current) return;
    const project = projects.find(
      (candidate) =>
        candidate.status === "ready" &&
        !candidate.mediaSource.posterPath &&
        !failuresRef.current.has(candidate.id),
    );
    if (!project) {
      if (refreshPendingRef.current > 0) {
        refreshPendingRef.current = 0;
        void refreshLibrary();
      }
      return;
    }

    busyRef.current = true;
    void ensureProjectPoster(project.id)
      .then((updated) => {
        setProjects((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        setActiveProject((current) =>
          current?.id === updated.id ? updated : current,
        );
        refreshPendingRef.current += 1;
        if (refreshPendingRef.current >= refreshBatchSize) {
          refreshPendingRef.current = 0;
          void refreshLibrary();
        }
      })
      .catch(() => failuresRef.current.add(project.id))
      .finally(() => {
        busyRef.current = false;
        if (enabledRef.current) {
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setQueueTick((tick) => tick + 1);
          }, queueDelayMs);
        }
      });
  }, [enabled, projects, queueTick, refreshLibrary, setActiveProject, setProjects]);
}
