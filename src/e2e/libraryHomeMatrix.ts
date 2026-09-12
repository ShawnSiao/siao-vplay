import type { LibraryHome, LibraryMediaSummary, LibrarySearchResult } from "../types";

const countText = new URLSearchParams(location.search).get("homeCount");
export const homeCount = countText !== null && ["0", "1", "20", "1000"].includes(countText) ? Number(countText) : null;

export function homeMatrixItems(items: LibraryMediaSummary[]): Partial<LibraryHome> {
  return homeCount === null ? {} : { continueWatching: items.slice(0, 4), continueWatchingCount: homeCount,
    recentlyAdded: items.slice(0, 8), totalProjectCount: homeCount };
}

// Presentation fixture only; backend search correctness is verified separately.
export function homeMatrixSearch(items: LibraryMediaSummary[], query: string): LibrarySearchResult[] {
  return homeCount === null ? [] : items.filter(item => item.projectTitle.includes(query.trim())).slice(0, 20).map(item => ({
    kind: "unclassified", projectId: item.projectId, collectionId: null, seasonNumber: null, episodeNumber: null,
    title: item.projectTitle, subtitle: item.displayName,
  }));
}
