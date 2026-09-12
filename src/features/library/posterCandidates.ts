import type { CollectionDetail, LibraryHome, LibraryMediaSummary } from "../../types";
import type { LibrarySection, LibrarySectionPages } from "./librarySectionState";

type State = {
  home: LibraryHome; section: LibrarySection; sectionPages: LibrarySectionPages;
  currentCollection: CollectionDetail | null; currentEpisodes: LibraryMediaSummary[]; searchQuery: string;
};

export function posterCandidates(state: State): LibraryMediaSummary[] {
  if (state.searchQuery.trim()) return [];
  const items = state.currentCollection ? state.currentEpisodes
    : state.section === "watch_later" ? state.sectionPages.watch_later.items
    : state.section === "unclassified" ? state.sectionPages.unclassified.items
    : state.section === "home" ? [...state.home.continueWatching, ...state.home.recentlyAdded, ...state.home.unclassified]
    : [];
  const unique = new Map<string, LibraryMediaSummary>();
  for (const item of items) {
    if (!unique.get(item.projectId)?.posterPath) unique.set(item.projectId, item);
  }
  return [...unique.values()];
}
