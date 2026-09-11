import { useEffect } from "react";
import { commandError } from "../../lib/commandError";
import type { LibrarySearchResult } from "../../types";
import { searchLibrary } from "./libraryGateway";

export type LibrarySearchAction =
  | { type: "search_started" }
  | { type: "search_loaded"; results: LibrarySearchResult[] }
  | { type: "search_failed"; message: string };

export function useLibrarySearch(queryText: string, dispatch: (action: LibrarySearchAction) => void, delayMs = 180) {
  useEffect(() => {
    const query = queryText.trim();
    let active = true;
    if (!query) { dispatch({ type: "search_loaded", results: [] }); return; }
    dispatch({ type: "search_started" });
    const timer = window.setTimeout(() => {
      void searchLibrary(query).then(results => {
        if (active) dispatch({ type: "search_loaded", results });
      }).catch((error: unknown) => {
        if (active) dispatch({ type: "search_failed", message: commandError(error).message });
      });
    }, delayMs);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [queryText, dispatch, delayMs]);
}
