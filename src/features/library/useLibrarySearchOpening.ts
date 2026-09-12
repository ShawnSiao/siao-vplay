import { useCallback } from "react";
import { getProject } from "../../lib/desktop";
import type { LibrarySearchResult, Project } from "../../types";
import type { EpisodePlaybackContext } from "./useEpisodeNavigation";

type Options = {
  clearSearch: (value: string) => void;
  selectSection: (section: "series") => void;
  openCollection: (id: string) => Promise<void>;
  openProject: (load: () => Promise<Project>, proxy: boolean, context: EpisodePlaybackContext | null) => Promise<void>;
  onError: (cause: unknown) => void;
};

export function useLibrarySearchOpening({ clearSearch, selectSection, openCollection, openProject, onError }: Options) {
  return useCallback((result: LibrarySearchResult) => {
    clearSearch("");
    if (result.kind === "collection" && result.collectionId) {
      selectSection("series");
      void openCollection(result.collectionId).catch(onError);
    } else if (result.projectId) {
      const projectId = result.projectId;
      void openProject(() => getProject(projectId), false, result.collectionId
        ? { collectionId: result.collectionId, seasonNumber: result.seasonNumber } : null).catch(onError);
    }
  }, [clearSearch, selectSection, openCollection, openProject, onError]);
}
