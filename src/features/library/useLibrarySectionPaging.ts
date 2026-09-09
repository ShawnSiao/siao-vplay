import { useCallback, useEffect, useRef } from "react";

import { commandError } from "../../lib/desktop";
import type { LibraryMediaSection } from "../../types";
import { listLibrarySection } from "./libraryGateway";
import type {
  LibrarySection,
  LibrarySectionAction,
  LibrarySectionPages,
} from "./librarySectionState";

export function useLibrarySectionPaging(
  section: LibrarySection,
  pages: LibrarySectionPages,
  dispatch: (action: LibrarySectionAction) => void,
) {
  const requestSequences = useRef<Record<LibraryMediaSection, number>>({
    continue_watching: 0,
    watch_later: 0,
    unclassified: 0,
  });

  const activeRequests = useRef<Partial<Record<LibraryMediaSection, number>>>({});
  useEffect(() => () => {
    for (const section of Object.keys(requestSequences.current) as LibraryMediaSection[]) {
      requestSequences.current[section] += 1;
    }
    activeRequests.current = {};
  }, []);

  const loadSectionPage = useCallback(
    async (mediaSection: LibraryMediaSection, offset = 0) => {
      if (offset > 0 && activeRequests.current[mediaSection] !== undefined) return null;
      const sequence = requestSequences.current[mediaSection] + 1;
      requestSequences.current[mediaSection] = sequence;
      activeRequests.current[mediaSection] = sequence;
      const append = offset > 0;
      dispatch({ type: "section_page_started", section: mediaSection, append });
      try {
        const page = await listLibrarySection(mediaSection, offset);
        if (requestSequences.current[mediaSection] === sequence) {
          dispatch({
            type: "section_page_loaded",
            section: mediaSection,
            items: page.items,
            totalCount: page.totalCount,
            nextOffset: page.nextOffset,
            append,
          });
        }
        return requestSequences.current[mediaSection] === sequence ? page : null;
      } catch (error) {
        if (requestSequences.current[mediaSection] === sequence) {
          dispatch({
            type: "section_page_failed",
            section: mediaSection,
            message: commandError(error).message,
          });
        }
        return null;
      } finally {
        if (activeRequests.current[mediaSection] === sequence) delete activeRequests.current[mediaSection];
      }
    },
    [dispatch],
  );

  useEffect(() => {
    const activeSection =
      section === "home"
        ? "continue_watching"
        : section === "watch_later" || section === "unclassified"
          ? section
          : null;
    if (!activeSection) {
      return;
    }
    const page = pages[activeSection];
    if (!page.initialized && !page.loading) {
      void loadSectionPage(activeSection);
    }
  }, [loadSectionPage, pages, section]);

  const loadMoreSection = useCallback(
    (mediaSection: LibraryMediaSection) => {
      const page = pages[mediaSection];
      if (page.nextOffset === null || page.loading || page.loadingMore) {
        return Promise.resolve(null);
      }
      return loadSectionPage(mediaSection, page.nextOffset);
    },
    [loadSectionPage, pages],
  );

  return { loadSectionPage, loadMoreSection };
}
