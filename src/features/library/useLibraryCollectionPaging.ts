import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject } from "react";
import { commandError } from "../../lib/desktop";
import type { CollectionDetail, LibraryMediaSummary } from "../../types";
import { getCollectionDetail, listCollectionEpisodePage } from "./libraryGateway";

export type CollectionReadAction =
  | { type: "collection_started" }
  | { type: "collection_loaded"; detail: CollectionDetail; episodes: LibraryMediaSummary[]; season: number | null }
  | { type: "collection_window_loaded"; collectionId: string; season: number | null; episodes: LibraryMediaSummary[] }
  | { type: "failed"; message: string };
type View = { currentCollection: CollectionDetail | null; selectedSeason: number | null; currentEpisodes: LibraryMediaSummary[]; collectionLoading: boolean };
type PageState = { scope: string | null; offset: number; pageSize: number; totalCount: number; nextOffset: number | null; snapshotToken: string | undefined; loadingMore: boolean; error: string | null };
const empty: PageState = { scope: null, offset: 0, pageSize: 0, totalCount: 0, nextOffset: null, snapshotToken: undefined, loadingMore: false, error: null };
const key = (id: string, season: number | null) => JSON.stringify([id, season]);

export function useLibraryCollectionPaging(view: View, dispatch: Dispatch<CollectionReadAction>, sequence: RefObject<number>) {
  const [pageState, setPageState] = useState(empty);
  const busy = useRef<number | null>(null);
  useEffect(() => () => { sequence.current += 1; }, [sequence]);
  const loadCollection = useCallback(async (collectionId: string, season: number | null = null, knownDetail?: CollectionDetail) => {
    const current = ++sequence.current;
    busy.current = current;
    dispatch({ type: "collection_started" });
    try {
      const [detail, page] = await Promise.all([
        knownDetail ?? getCollectionDetail(collectionId), listCollectionEpisodePage(collectionId, season, 0),
      ]);
      if (current !== sequence.current) return;
      dispatch({ type: "collection_loaded", detail, episodes: page.items, season });
      setPageState({ scope: key(collectionId, season), offset: 0, pageSize: page.items.length, totalCount: page.totalCount, nextOffset: page.nextOffset,
        snapshotToken: page.snapshotToken, loadingMore: false, error: null });
    } catch (error) {
      if (current !== sequence.current) return;
      const message = commandError(error).message;
      if (knownDetail) dispatch({ type: "collection_loaded", detail: knownDetail, episodes: [], season });
      else dispatch({ type: "failed", message });
      setPageState(previous => knownDetail
        ? { ...empty, scope: key(collectionId, season), error: message }
        : { ...previous, scope: previous.scope ?? key(collectionId, season), loadingMore: false, error: message });
    } finally { if (busy.current === current) busy.current = null; }
  }, [dispatch, sequence]);
  const collectionId = view.currentCollection?.summary.id ?? null;
  const scope = collectionId ? key(collectionId, view.selectedSeason) : null;
  const visible = pageState.scope === scope ? pageState : empty;
  const loadPage = async (offset: number | null) => {
    if (!collectionId || offset === null || view.collectionLoading || busy.current === sequence.current) return false;
    const current = ++sequence.current;
    busy.current = current;
    setPageState(previous => ({ ...previous, loadingMore: true, error: null }));
    try {
      const page = await listCollectionEpisodePage(collectionId, view.selectedSeason, offset, visible.snapshotToken);
      if (current !== sequence.current) return false;
      const ids = [...view.currentEpisodes, ...page.items].map(item => item.projectId);
      if (page.snapshotToken !== visible.snapshotToken || page.totalCount !== visible.totalCount || new Set(ids).size !== ids.length
        || (page.nextOffset !== null && page.items.length !== visible.pageSize)) {
        throw new Error("合集已变化，请重新加载剧集");
      }
      dispatch({ type: "collection_window_loaded", collectionId, season: view.selectedSeason, episodes: page.items });
      setPageState(previous => ({ ...previous, offset, nextOffset: page.nextOffset, loadingMore: false, error: null }));
      return true;
    } catch (error) {
      if (current === sequence.current) setPageState(previous => ({ ...previous, loadingMore: false, error: commandError(error).message }));
      return false;
    } finally { if (busy.current === current) busy.current = null; }
  };
  const collectionPagination: LibraryCollectionPagination = {
    offset: visible.offset,
    totalCount: visible.totalCount, nextOffset: visible.nextOffset, loadingMore: visible.loadingMore, error: visible.error,
    loadMore: () => loadPage(visible.nextOffset),
    loadPrevious: () => loadPage(visible.offset > 0 ? Math.max(0, visible.offset - visible.pageSize) : null),
    reload: () => { if (collectionId) void loadCollection(collectionId, view.selectedSeason); },
  };
  return { loadCollection, collectionPagination };
}
export type LibraryCollectionPagination = { totalCount: number; nextOffset: number | null; loadingMore: boolean; error: string | null;
  loadMore: () => Promise<boolean>; reload: () => void; offset?: number; loadPrevious?: () => Promise<boolean> };
