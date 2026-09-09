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
    async (mediaSection: LibraryMediaSection, offset = 0, continuation = false) => {
      if ((offset > 0 || continuation) && activeRequests.current[mediaSection] !== undefined) return null;
      const base = pages[mediaSection];
      // Home previews are not continuation snapshots. Establish a full first page
      // before using a cursor derived from a preview or refreshed home response.
      if (continuation && !base.snapshotToken) { offset = 0; continuation = false; }
      const sequence = requestSequences.current[mediaSection] + 1;
      requestSequences.current[mediaSection] = sequence;
      activeRequests.current[mediaSection] = sequence;
      const append = continuation;
      dispatch({ type: "section_page_started", section: mediaSection, append, requestId: sequence });
      try {
        const page = await listLibrarySection(mediaSection, offset, append ? base.snapshotToken : undefined);
        if (requestSequences.current[mediaSection] === sequence) {
          if (append && (page.snapshotToken !== base.snapshotToken || page.totalCount !== base.totalCount
            || (base.pageSize !== undefined && page.nextOffset !== null && page.items.length !== base.pageSize)
            || (offset !== base.offset && page.items.some(item => base.items.some(existing => existing.projectId === item.projectId))))) {
            throw new Error("媒体列表已变化，请重新加载");
          }
          dispatch({
            type: "section_page_loaded",
            requestId: sequence,
            section: mediaSection,
            items: page.items,
            totalCount: page.totalCount,
            nextOffset: page.nextOffset,
            snapshotToken: page.snapshotToken,
            offset, pageSize: append ? base.pageSize ?? base.items.length : page.items.length,
            append,
          });
        }
        return requestSequences.current[mediaSection] === sequence ? page : null;
      } catch (error) {
        if (requestSequences.current[mediaSection] === sequence) {
          dispatch({
            type: "section_page_failed",
            requestId: sequence,
            section: mediaSection,
            message: commandError(error).message,
            offset, continuation,
          });
        }
        return null;
      } finally {
        if (activeRequests.current[mediaSection] === sequence) delete activeRequests.current[mediaSection];
      }
    },
    [dispatch, pages],
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
      return loadSectionPage(mediaSection, page.nextOffset, true);
    },
    [loadSectionPage, pages],
  );

  const loadPreviousSection = (mediaSection: LibraryMediaSection) => {
    const page = pages[mediaSection];
    return page.offset && page.pageSize && !page.loading && !page.loadingMore
      ? loadSectionPage(mediaSection, Math.max(0, page.offset - page.pageSize), true) : Promise.resolve(null);
  };
  const retrySection = (mediaSection: LibraryMediaSection) => {
    const page = pages[mediaSection];
    return page.failedOffset !== undefined && !page.loading && !page.loadingMore
      ? loadSectionPage(mediaSection, page.failedOffset, page.failedContinuation) : Promise.resolve(null);
  };
  return { loadSectionPage, loadMoreSection, loadPreviousSection, retrySection };
}
