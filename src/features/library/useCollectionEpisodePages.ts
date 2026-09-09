import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { commandError } from "../../lib/desktop";
import type { CollectionEpisodePage } from "../../generated/collection-episode-page";
import { listCollectionEpisodePage } from "./libraryGateway";

type Loaded = Pick<CollectionEpisodePage, "items" | "totalCount" | "nextOffset" | "snapshotToken">;
type State = { scope: string | null; page: Loaded | null; loading: boolean; error: string | null };
const empty: State = { scope: null, page: null, loading: false, error: null };
type Action = { type: "reset" } | { type: "start"; scope: string; append: boolean }
  | { type: "loaded"; page: Loaded } | { type: "failed"; error: string };
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset": return empty;
    case "start": return { scope: action.scope, page: action.append ? state.page : null, loading: true, error: null };
    case "loaded": return { ...state, page: action.page, loading: false, error: null };
    case "failed": return { ...state, loading: false, error: action.error };
  }
}

export function useCollectionEpisodePages(collectionId: string | null, seasonNumber: number | null, enabled: boolean, sessionKey: string | null) {
  const [state, dispatch] = useReducer(reducer, empty);
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const busy = useRef(false);
  const scope = enabled && collectionId ? JSON.stringify([collectionId, seasonNumber, sessionKey, attempt]) : null;
  const request = useCallback(async (base: Loaded | null) => {
    if (!scope || !collectionId) { dispatch({ type: "reset" }); return; }
    if (busy.current || (base && base.nextOffset === null)) return;
    busy.current = true;
    const current = ++sequence.current;
    dispatch({ type: "start", scope, append: base !== null });
    try {
      const page = await listCollectionEpisodePage(collectionId, seasonNumber, base?.nextOffset ?? 0, base?.snapshotToken);
      if (current !== sequence.current) return;
      const items = [...(base?.items ?? []), ...page.items];
      if ((base && (page.totalCount !== base.totalCount || page.snapshotToken !== base.snapshotToken))
        || new Set(items.map(item => item.projectId)).size !== items.length) {
        throw new Error("合集已变化，请重新加载剧集");
      }
      dispatch({ type: "loaded", page: { items, totalCount: page.totalCount, nextOffset: page.nextOffset, snapshotToken: page.snapshotToken } });
    } catch (error) {
      if (current === sequence.current) dispatch({ type: "failed", error: commandError(error).message });
    } finally { if (current === sequence.current) busy.current = false; }
  }, [collectionId, seasonNumber, scope]);
  useEffect(() => {
    busy.current = false;
    void request(null);
    return () => { sequence.current += 1; busy.current = false; };
  }, [request]);
  const visible = state.scope === scope ? state : { ...empty, loading: scope !== null };
  return {
    items: visible.page?.items ?? [], totalCount: visible.page?.totalCount ?? 0,
    nextOffset: visible.page?.nextOffset ?? null, loading: visible.loading, error: visible.error,
    loadMore: () => { if (visible.page) void request(visible.page); },
    reload: () => setAttempt(value => value + 1),
  };
}

export type EpisodePagination = ReturnType<typeof useCollectionEpisodePages>;
