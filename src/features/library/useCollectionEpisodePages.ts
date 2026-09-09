import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { commandError } from "../../lib/desktop";
import type { CollectionEpisodePage } from "../../generated/collection-episode-page";
import { listCollectionEpisodePage } from "./libraryGateway";

type Loaded = Pick<CollectionEpisodePage, "items" | "totalCount" | "nextOffset" | "snapshotToken"> & { offset: number; pageSize: number };
type State = { scope: string | null; page: Loaded | null; loading: boolean; error: string | null; failedOffset: number | null; currentEpisode: Loaded["items"][number] | null };
const empty: State = { scope: null, page: null, loading: false, error: null, failedOffset: null, currentEpisode: null };
type Action = { type: "reset" } | { type: "start"; scope: string; append: boolean }
  | { type: "loaded"; page: Loaded; projectId: string | null } | { type: "failed"; error: string; offset: number };
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset": return empty;
    case "start": return { scope: action.scope, page: action.append ? state.page : null, loading: true, error: null, failedOffset: null,
      currentEpisode: action.append ? state.currentEpisode : null };
    case "loaded": return { ...state, page: action.page, loading: false, error: null, failedOffset: null,
      currentEpisode: action.page.items.find(item => item.projectId === action.projectId) ?? state.currentEpisode };
    case "failed": return { ...state, loading: false, error: action.error, failedOffset: action.offset };
  }
}

export function useCollectionEpisodePages(collectionId: string | null, seasonNumber: number | null, enabled: boolean, sessionKey: string | null) {
  const [state, dispatch] = useReducer(reducer, empty);
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const busy = useRef(false);
  const scope = enabled && collectionId ? JSON.stringify([collectionId, seasonNumber, sessionKey, attempt]) : null;
  const request = useCallback(async (base: Loaded | null, offset: number | null = 0) => {
    if (!scope || !collectionId) { dispatch({ type: "reset" }); return false; }
    if (busy.current || offset === null) return false;
    busy.current = true;
    const current = ++sequence.current;
    dispatch({ type: "start", scope, append: base !== null });
    try {
      const page = await listCollectionEpisodePage(collectionId, seasonNumber, offset, base?.snapshotToken);
      if (current !== sequence.current) return false;
      const items = [...(base?.items ?? []), ...page.items];
      if ((base && (page.totalCount !== base.totalCount || page.snapshotToken !== base.snapshotToken
          || (page.nextOffset !== null && page.items.length !== base.pageSize)))
        || new Set(items.map(item => item.projectId)).size !== items.length) {
        throw new Error("合集已变化，请重新加载剧集");
      }
      dispatch({ type: "loaded", page: { ...page, offset, pageSize: base?.pageSize ?? page.items.length }, projectId: sessionKey });
      return true;
    } catch (error) {
      if (current === sequence.current) dispatch({ type: "failed", error: commandError(error).message, offset });
      return false;
    } finally { if (current === sequence.current) busy.current = false; }
  }, [collectionId, seasonNumber, scope, sessionKey]);
  useEffect(() => {
    busy.current = false;
    void request(null);
    return () => { sequence.current += 1; busy.current = false; };
  }, [request]);
  const visible = state.scope === scope ? state : { ...empty, loading: scope !== null };
  return {
    items: visible.page?.items ?? [], totalCount: visible.page?.totalCount ?? 0,
    nextOffset: visible.page?.nextOffset ?? null, loading: visible.loading, error: visible.error,
    offset: visible.page?.offset ?? 0,
    currentEpisode: visible.currentEpisode,
    loadMore: () => visible.page ? request(visible.page, visible.page.nextOffset) : Promise.resolve(false),
    loadPrevious: () => visible.page && visible.page.offset > 0
      ? request(visible.page, Math.max(0, visible.page.offset - visible.page.pageSize)) : Promise.resolve(false),
    retry: () => request(visible.page, visible.failedOffset),
    reload: () => setAttempt(value => value + 1),
  };
}

export type EpisodePagination = Omit<ReturnType<typeof useCollectionEpisodePages>, "offset" | "loadPrevious" | "retry" | "currentEpisode"> & {
  offset?: number; loadPrevious?: () => Promise<boolean>; retry?: () => Promise<boolean>;
};
