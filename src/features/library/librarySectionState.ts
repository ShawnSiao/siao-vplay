import type {
  LibraryHome,
  LibraryMediaSection,
  LibraryMediaSummary,
} from "../../types";

export type LibrarySection =
  | "home"
  | "series"
  | "folders"
  | "watch_later"
  | "unclassified";

export type LibrarySectionPageState = {
  items: LibraryMediaSummary[];
  totalCount: number;
  nextOffset: number | null;
  initialized: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
};

export type LibrarySectionPages = Record<
  LibraryMediaSection,
  LibrarySectionPageState
>;

export type LibrarySectionAction =
  | {
      type: "section_page_started";
      section: LibraryMediaSection;
      append: boolean;
    }
  | {
      type: "section_page_loaded";
      section: LibraryMediaSection;
      items: LibraryMediaSummary[];
      totalCount: number;
      nextOffset: number | null;
      append: boolean;
    }
  | {
      type: "section_page_failed";
      section: LibraryMediaSection;
      message: string;
    }
  | {
      type: "section_page_remove";
      section: LibraryMediaSection;
      projectId: string;
    };

export const librarySectionStorageKey = "siaovplay-library-section";

export function emptySectionPage(): LibrarySectionPageState {
  return {
    items: [],
    totalCount: 0,
    nextOffset: null,
    initialized: false,
    loading: false,
    loadingMore: false,
    error: null,
  };
}

export function emptySectionPages(): LibrarySectionPages {
  return {
    continue_watching: emptySectionPage(),
    watch_later: emptySectionPage(),
    unclassified: emptySectionPage(),
  };
}

export function storedLibrarySection(): LibrarySection {
  const fallback: LibrarySection = "home";
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window.localStorage.getItem(librarySectionStorageKey);
  return value === "home" ||
    value === "series" ||
    value === "folders" ||
    value === "watch_later" ||
    value === "unclassified"
    ? value
    : fallback;
}

export function sectionsFromHome(
  current: LibrarySectionPages,
  home: LibraryHome,
): LibrarySectionPages {
  const continueTotal = home.continueWatchingCount ?? home.continueWatching.length;
  const watchLaterTotal =
    home.collections.find((item) => item.systemKey === "watch_later")?.itemCount ?? 0;
  return {
    continue_watching: {
      items: home.continueWatching,
      totalCount: continueTotal,
      nextOffset:
        home.continueWatching.length < continueTotal
          ? home.continueWatching.length
          : null,
      initialized: true,
      loading: false,
      loadingMore: false,
      error: null,
    },
    watch_later: current.watch_later.initialized
      ? current.watch_later
      : { ...emptySectionPage(), totalCount: watchLaterTotal },
    unclassified: {
      items: home.unclassified,
      totalCount: home.unclassifiedCount,
      nextOffset:
        home.unclassified.length < home.unclassifiedCount
          ? home.unclassified.length
          : null,
      initialized: true,
      loading: false,
      loadingMore: false,
      error: null,
    },
  };
}

function mergePageItems(
  current: LibraryMediaSummary[],
  incoming: LibraryMediaSummary[],
): LibraryMediaSummary[] {
  const items = new Map(current.map((item) => [item.projectId, item]));
  for (const item of incoming) {
    items.set(item.projectId, item);
  }
  return Array.from(items.values());
}

export function reduceSectionPages(
  pages: LibrarySectionPages,
  action: LibrarySectionAction,
): LibrarySectionPages {
  const page = pages[action.section];
  switch (action.type) {
    case "section_page_started":
      return {
        ...pages,
        [action.section]: {
          ...page,
          loading: !action.append,
          loadingMore: action.append,
          error: null,
        },
      };
    case "section_page_loaded":
      return {
        ...pages,
        [action.section]: {
          items: action.append ? mergePageItems(page.items, action.items) : action.items,
          totalCount: action.totalCount,
          nextOffset: action.nextOffset,
          initialized: true,
          loading: false,
          loadingMore: false,
          error: null,
        },
      };
    case "section_page_failed":
      return {
        ...pages,
        [action.section]: {
          ...page,
          initialized: true,
          loading: false,
          loadingMore: false,
          error: action.message,
        },
      };
    case "section_page_remove": {
      const items = page.items.filter((item) => item.projectId !== action.projectId);
      const removed = items.length !== page.items.length;
      return {
        ...pages,
        [action.section]: {
          ...page,
          items,
          totalCount: removed ? Math.max(0, page.totalCount - 1) : page.totalCount,
        },
      };
    }
  }
}

export function removeUnclassifiedProject(
  home: LibraryHome,
  pages: LibrarySectionPages,
  projectId: string,
): { home: LibraryHome; pages: LibrarySectionPages } {
  const removedFromPage = pages.unclassified.items.some(
    (item) => item.projectId === projectId,
  );
  const removedFromHome = home.unclassified.some((item) => item.projectId === projectId);
  const removed = removedFromPage || removedFromHome;
  return {
    pages: {
      ...pages,
      unclassified: {
        ...pages.unclassified,
        items: pages.unclassified.items.filter((item) => item.projectId !== projectId),
        totalCount: removed
          ? Math.max(0, pages.unclassified.totalCount - 1)
          : pages.unclassified.totalCount,
      },
    },
    home: {
      ...home,
      unclassified: home.unclassified.filter((item) => item.projectId !== projectId),
      unclassifiedCount: removed
        ? Math.max(0, home.unclassifiedCount - 1)
        : home.unclassifiedCount,
    },
  };
}
