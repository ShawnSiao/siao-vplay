import { useCallback, useEffect, useReducer, useRef } from "react";

import { commandError } from "../../lib/desktop";
import type {
  CollectionDetail,
  EpisodeNeighbors,
  LibraryMediaSummary,
} from "../../types";
import {
  getCollectionDetail,
  getEpisodeNeighbors,
  listCollectionEpisodes,
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
const initialState: EpisodeNavigationState = {
  detail: null,
  episodes: [],
  neighbors: emptyNeighbors,
  loading: false,
  error: null,
};

type Action =
  | { type: "reset" }
  | { type: "started" }
  | {
      type: "loaded";
      detail: CollectionDetail;
      episodes: LibraryMediaSummary[];
      neighbors: EpisodeNeighbors;
    }
  | { type: "failed"; message: string };

function reducer(state: EpisodeNavigationState, action: Action): EpisodeNavigationState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "started":
      return { ...state, loading: true, error: null };
    case "loaded":
      return {
        detail: action.detail,
        episodes: action.episodes,
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
) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (!context || !projectId) {
      dispatch({ type: "reset" });
      return;
    }
    dispatch({ type: "started" });
    try {
      const [detail, episodes, neighbors] = await Promise.all([
        getCollectionDetail(context.collectionId),
        listCollectionEpisodes(context.collectionId, context.seasonNumber),
        getEpisodeNeighbors(context.collectionId, projectId),
      ]);
      if (requestSequence.current === sequence) {
        dispatch({ type: "loaded", detail, episodes, neighbors });
      }
    } catch (error) {
      if (requestSequence.current === sequence) {
        dispatch({ type: "failed", message: commandError(error).message });
      }
    }
  }, [context, projectId]);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  return { state, refresh };
}
