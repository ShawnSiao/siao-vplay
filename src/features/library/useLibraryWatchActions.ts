import { useCallback, type Dispatch } from "react";
import type { CollectionDetail, Project } from "../../types";
import { setProjectWatched, setWatchLater } from "./libraryGateway";

export type WatchAction =
  | { type: "upsert_detail"; detail: CollectionDetail }
  | { type: "remove_unclassified"; projectId: string }
  | { type: "section_page_remove"; section: "watch_later"; projectId: string }
  | { type: "watch_state_changed"; project: Project };
type RunMutation = <T>(operation: () => Promise<T>, apply: (result: T) => void) => Promise<T | null>;

export function useLibraryWatchActions(runMutation: RunMutation, dispatch: Dispatch<WatchAction>) {
  const changeWatchLater = useCallback((projectId: string, enabled: boolean) =>
    runMutation(() => setWatchLater(projectId, enabled), detail => {
      if (detail) dispatch({ type: "upsert_detail", detail });
      if (enabled) dispatch({ type: "remove_unclassified", projectId });
      else dispatch({ type: "section_page_remove", section: "watch_later", projectId });
    }), [runMutation, dispatch]);
  const changeWatched = useCallback((projectId: string, watched: boolean) =>
    runMutation(() => setProjectWatched(projectId, watched), project =>
      dispatch({ type: "watch_state_changed", project })), [runMutation, dispatch]);
  return { changeWatchLater, changeWatched };
}
