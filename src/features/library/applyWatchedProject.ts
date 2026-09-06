import type { CollectionDetail, LibraryHome, LibraryMediaSummary, Project } from "../../types";
import type { LibrarySectionPages } from "./librarySectionState";

type State = { home: LibraryHome; sectionPages: LibrarySectionPages; currentEpisodes: LibraryMediaSummary[]; currentCollection: CollectionDetail | null };

export function applyWatchedProject<T extends State>(state: T, project: Pick<Project, "id" | "playbackState">): T {
  const map = (items: LibraryMediaSummary[]) => items.map(item => item.projectId === project.id
    ? { ...item, completedAtMs: project.playbackState.completedAtMs } : item);
  const previous = state.currentEpisodes.find(item => item.projectId === project.id);
  const delta = previous ? Number(project.playbackState.completedAtMs !== null) - Number(previous.completedAtMs !== null) : 0;
  return { ...state,
    home: { ...state.home, continueWatching: map(state.home.continueWatching), recentlyAdded: map(state.home.recentlyAdded), unclassified: map(state.home.unclassified) },
    sectionPages: {
      continue_watching: { ...state.sectionPages.continue_watching, items: map(state.sectionPages.continue_watching.items) },
      watch_later: { ...state.sectionPages.watch_later, items: map(state.sectionPages.watch_later.items) },
      unclassified: { ...state.sectionPages.unclassified, items: map(state.sectionPages.unclassified.items) },
    },
    currentEpisodes: map(state.currentEpisodes),
    currentCollection: state.currentCollection ? { ...state.currentCollection,
      summary: { ...state.currentCollection.summary, watchedCount: Math.max(0, state.currentCollection.summary.watchedCount + delta) },
      seasons: state.currentCollection.seasons.map(season => previous && season.seasonNumber === previous.seasonNumber
        ? { ...season, watchedCount: Math.max(0, season.watchedCount + delta) } : season),
    } : null,
  };
}
