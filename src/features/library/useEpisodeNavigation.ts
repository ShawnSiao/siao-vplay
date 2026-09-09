import { useCallback, useEffect, useReducer, useRef } from "react";

import { useCollectionEpisodePages } from "./useCollectionEpisodePages";
import { commandError } from "../../lib/desktop";
import type {
  CollectionDetail,
  EpisodeNeighbors,
  LibraryMediaSummary,
} from "../../types";
import {
  getCollectionDetail,
  getEpisodeNeighbors,
} from "./libraryGateway";

export type EpisodePlaybackContext = {
  collectionId: string;
  seasonNumber: number | null;
};

export type EpisodeNavigationState = {
  detail: CollectionDetail | null;
  episodes: LibraryMediaSummary[];
  neighbors: EpisodeNeighbors;
  loading: boolean;
  error: string | null;
};

const emptyNeighbors: EpisodeNeighbors = { previous: null, next: null };
type OwnedState = Omit<EpisodeNavigationState, "episodes"> & { scope: string | null };
const initialState: OwnedState = {
  scope: null,
  detail: null,
  neighbors: emptyNeighbors,
  loading: false,
  error: null,
};

type Action =
  | { type: "reset" }
  | { type: "started"; scope: string }
  | {
      type: "loaded";
      detail: CollectionDetail;
      neighbors: EpisodeNeighbors;
    }
  | { type: "failed"; message: string };

function reducer(state: OwnedState, action: Action): OwnedState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "started":
      return { ...initialState, scope: action.scope, loading: true };
    case "loaded":
      return {
        scope: state.scope,
        detail: action.detail,
        neighbors: action.neighbors,
        loading: false,
        error: null,
      };
    case "failed":
      return { ...state, loading: false, error: action.message };
  }
}

export function useEpisodeNavigation(
  context: EpisodePlaybackContext | null,
  projectId: string | null,
  includeEpisodes = false,
) {
  const pages = useCollectionEpisodePages(context?.collectionId ?? null, context?.seasonNumber ?? null, includeEpisodes, projectId);
  const [state, dispatch] = useReducer(reducer, initialState);
  const requestSequence = useRef(0);
  const scope = context && projectId ? JSON.stringify([context.collectionId, context.seasonNumber, projectId]) : null;

  const refresh = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (!context || !projectId || !scope) {
      dispatch({ type: "reset" });
      return;
    }
    dispatch({ type: "started", scope });
    try {
      const [detail, neighbors] = await Promise.all([
        getCollectionDetail(context.collectionId),
        getEpisodeNeighbors(context.collectionId, projectId),
      ]);
      if (requestSequence.current === sequence) {
        dispatch({ type: "loaded", detail, neighbors });
      }
    } catch (error) {
      if (requestSequence.current === sequence) {
        dispatch({ type: "failed", message: commandError(error).message });
      }
    }
  }, [context, projectId, scope]);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  const visibleState = state.scope === scope ? state : { ...initialState, loading: scope !== null };
  return { state: { ...visibleState, episodes: pages.items, loading: visibleState.loading || pages.loading }, refresh,
    pagination: { ...pages, reload: () => { pages.reload(); void refresh(); } } };
}
