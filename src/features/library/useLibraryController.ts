import { useCallback, useEffect, useReducer, useRef } from "react";

import { commandError } from "../../lib/desktop";
import type {
  CollectionDetail,
  CollectionSortMode,
  LibraryCollection,
  LibraryHome,
  LibraryMediaSummary,
  LibrarySearchResult,
} from "../../types";
import {
  addProjectToCollection,
  createCollection,
  deleteCollection,
  emptyLibraryHome,
  getCollectionDetail,
  getLibraryHome,
  listCollectionEpisodes,
  removeProjectFromCollection,
  searchLibrary,
  setWatchLater,
  toCollectionSummary,
  updateCollection,
} from "./libraryGateway";

export type LibrarySection = "home" | "series" | "watch_later" | "unclassified";

type LibraryState = {
  home: LibraryHome;
  loading: boolean;
  error: string | null;
  section: LibrarySection;
  currentCollection: CollectionDetail | null;
  currentEpisodes: LibraryMediaSummary[];
  selectedSeason: number | null;
  collectionLoading: boolean;
  searchQuery: string;
  searchResults: LibrarySearchResult[];
  searchLoading: boolean;
  mutationPending: boolean;
  refreshSequence: number;
  scanPreview: null;
};

type LibraryAction =
  | { type: "home_started" }
  | { type: "home_loaded"; home: LibraryHome; sequence: number }
  | { type: "failed"; message: string }
  | { type: "set_section"; section: LibrarySection }
  | { type: "collection_started"; season: number | null }
  | {
      type: "collection_loaded";
      detail: CollectionDetail;
      episodes: LibraryMediaSummary[];
      season: number | null;
    }
  | { type: "close_collection" }
  | { type: "set_search_query"; query: string }
  | { type: "search_started" }
  | { type: "search_loaded"; results: LibrarySearchResult[] }
  | { type: "mutation_started" }
  | { type: "mutation_finished" }
  | { type: "upsert_collection"; collection: LibraryCollection }
  | { type: "upsert_detail"; detail: CollectionDetail }
  | { type: "remove_collection"; collectionId: string }
  | { type: "remove_unclassified"; projectId: string };

const initialState: LibraryState = {
  home: emptyLibraryHome,
  loading: true,
  error: null,
  section: "home",
  currentCollection: null,
  currentEpisodes: [],
  selectedSeason: null,
  collectionLoading: false,
  searchQuery: "",
  searchResults: [],
  searchLoading: false,
  mutationPending: false,
  refreshSequence: 0,
  scanPreview: null,
};

function libraryReducer(state: LibraryState, action: LibraryAction): LibraryState {
  switch (action.type) {
    case "home_started":
      return { ...state, loading: true };
    case "home_loaded":
      return {
        ...state,
        home: action.home,
        loading: false,
        error: null,
        refreshSequence: action.sequence,
      };
    case "failed":
      return {
        ...state,
        loading: false,
        collectionLoading: false,
        searchLoading: false,
        mutationPending: false,
        error: action.message,
      };
    case "set_section":
      return {
        ...state,
        section: action.section,
        currentCollection: null,
        currentEpisodes: [],
        selectedSeason: null,
      };
    case "collection_started":
      return { ...state, collectionLoading: true, selectedSeason: action.season };
    case "collection_loaded":
      return {
        ...state,
        currentCollection: action.detail,
        currentEpisodes: action.episodes,
        selectedSeason: action.season,
        collectionLoading: false,
        error: null,
      };
    case "close_collection":
      return {
        ...state,
        currentCollection: null,
        currentEpisodes: [],
        selectedSeason: null,
      };
    case "set_search_query":
      return {
        ...state,
        searchQuery: action.query,
        searchResults: action.query.trim() ? state.searchResults : [],
      };
    case "search_started":
      return { ...state, searchLoading: true };
    case "search_loaded":
      return { ...state, searchResults: action.results, searchLoading: false };
    case "mutation_started":
      return { ...state, mutationPending: true, error: null };
    case "mutation_finished":
      return { ...state, mutationPending: false };
    case "upsert_collection": {
      const existing = state.home.collections.find(
        (item) => item.id === action.collection.id,
      );
      const summary = existing
        ? { ...existing, ...action.collection }
        : toCollectionSummary(action.collection);
      return {
        ...state,
        currentCollection:
          state.currentCollection?.summary.id === action.collection.id
            ? {
                ...state.currentCollection,
                summary: {
                  ...state.currentCollection.summary,
                  ...action.collection,
                },
              }
            : state.currentCollection,
        home: {
          ...state.home,
          collections: [
            summary,
            ...state.home.collections.filter((item) => item.id !== summary.id),
          ],
        },
      };
    }
    case "upsert_detail":
      return {
        ...state,
        currentCollection:
          state.currentCollection?.summary.id === action.detail.summary.id
            ? action.detail
            : state.currentCollection,
        home: {
          ...state.home,
          collections: [
            action.detail.summary,
            ...state.home.collections.filter(
              (item) => item.id !== action.detail.summary.id,
            ),
          ],
        },
      };
    case "remove_collection":
      return {
        ...state,
        currentCollection:
          state.currentCollection?.summary.id === action.collectionId
            ? null
            : state.currentCollection,
        currentEpisodes:
          state.currentCollection?.summary.id === action.collectionId
            ? []
            : state.currentEpisodes,
        home: {
          ...state.home,
          collections: state.home.collections.filter(
            (item) => item.id !== action.collectionId,
          ),
        },
      };
    case "remove_unclassified":
      return {
        ...state,
        home: {
          ...state.home,
          unclassified: state.home.unclassified.filter(
            (item) => item.projectId !== action.projectId,
          ),
          unclassifiedCount: Math.max(0, state.home.unclassifiedCount - 1),
        },
      };
  }
}

export function useLibraryController() {
  const [state, dispatch] = useReducer(libraryReducer, initialState);
  const homeRequestSequence = useRef(0);
  const collectionRequestSequence = useRef(0);
  const searchRequestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = homeRequestSequence.current + 1;
    homeRequestSequence.current = sequence;
    dispatch({ type: "home_started" });
    try {
      const home = await getLibraryHome();
      if (homeRequestSequence.current === sequence) {
        dispatch({ type: "home_loaded", home, sequence });
      }
    } catch (error) {
      if (homeRequestSequence.current === sequence) {
        dispatch({ type: "failed", message: commandError(error).message });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const query = state.searchQuery.trim();
    const sequence = searchRequestSequence.current + 1;
    searchRequestSequence.current = sequence;
    if (!query) {
      dispatch({ type: "search_loaded", results: [] });
      return undefined;
    }
    dispatch({ type: "search_started" });
    const timer = window.setTimeout(() => {
      void searchLibrary(query)
        .then((results) => {
          if (searchRequestSequence.current === sequence) {
            dispatch({ type: "search_loaded", results });
          }
        })
        .catch((error: unknown) => {
          if (searchRequestSequence.current === sequence) {
            dispatch({ type: "failed", message: commandError(error).message });
          }
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [state.searchQuery]);

  const loadCollection = useCallback(
    async (collectionId: string, seasonNumber: number | null = null) => {
      const sequence = collectionRequestSequence.current + 1;
      collectionRequestSequence.current = sequence;
      dispatch({ type: "collection_started", season: seasonNumber });
      try {
        const [detail, episodes] = await Promise.all([
          getCollectionDetail(collectionId),
          listCollectionEpisodes(collectionId, seasonNumber),
        ]);
        if (collectionRequestSequence.current === sequence) {
          dispatch({
            type: "collection_loaded",
            detail,
            episodes,
            season: seasonNumber,
          });
        }
      } catch (error) {
        if (collectionRequestSequence.current === sequence) {
          dispatch({ type: "failed", message: commandError(error).message });
        }
      }
    },
    [],
  );

  const runMutation = useCallback(
    async <T,>(operation: () => Promise<T>, apply: (result: T) => void) => {
      dispatch({ type: "mutation_started" });
      try {
        const result = await operation();
        apply(result);
        dispatch({ type: "mutation_finished" });
        void refresh();
        return result;
      } catch (error) {
        dispatch({ type: "failed", message: commandError(error).message });
        return null;
      }
    },
    [refresh],
  );

  const createManualCollection = useCallback(
    (title: string) =>
      runMutation(
        () => createCollection({ title }),
        (collection) => dispatch({ type: "upsert_collection", collection }),
      ),
    [runMutation],
  );

  const editCollection = useCallback(
    (
      collectionId: string,
      values: {
        title?: string;
        sortMode?: CollectionSortMode;
        autoPlayNext?: boolean;
      },
    ) =>
      runMutation(
        () => updateCollection({ collectionId, ...values }),
        (collection) => dispatch({ type: "upsert_collection", collection }),
      ),
    [runMutation],
  );

  const removeCollection = useCallback(
    (collectionId: string) =>
      runMutation(
        () => deleteCollection(collectionId),
        () => dispatch({ type: "remove_collection", collectionId }),
      ),
    [runMutation],
  );

  const addToCollection = useCallback(
    (collectionId: string, projectId: string) =>
      runMutation(
        () => addProjectToCollection({ collectionId, projectId }),
        (detail) => {
          dispatch({ type: "upsert_detail", detail });
          dispatch({ type: "remove_unclassified", projectId });
        },
      ),
    [runMutation],
  );

  const removeFromCollection = useCallback(
    (collectionId: string, projectId: string) =>
      runMutation(
        () => removeProjectFromCollection(collectionId, projectId),
        (detail) => {
          dispatch({ type: "upsert_detail", detail });
          if (state.currentCollection?.summary.id === collectionId) {
            void loadCollection(collectionId, state.selectedSeason);
          }
        },
      ),
    [loadCollection, runMutation, state.currentCollection?.summary.id, state.selectedSeason],
  );

  const changeWatchLater = useCallback(
    (projectId: string, enabled: boolean) =>
      runMutation(
        () => setWatchLater(projectId, enabled),
        (detail) => {
          if (detail) {
            dispatch({ type: "upsert_detail", detail });
          }
        },
      ),
    [runMutation],
  );

  const setSection = useCallback((section: LibrarySection) => {
    dispatch({ type: "set_section", section });
  }, []);
  const setSearchQuery = useCallback((query: string) => {
    dispatch({ type: "set_search_query", query });
  }, []);
  const closeCollection = useCallback(() => {
    dispatch({ type: "close_collection" });
  }, []);
  const selectSeason = useCallback(
    (season: number | null) => {
      const collectionId = state.currentCollection?.summary.id;
      if (collectionId) {
        void loadCollection(collectionId, season);
      }
    },
    [loadCollection, state.currentCollection?.summary.id],
  );

  return {
    state,
    refresh,
    setSection,
    setSearchQuery,
    openCollection: loadCollection,
    closeCollection,
    selectSeason,
    createManualCollection,
    editCollection,
    removeCollection,
    addToCollection,
    removeFromCollection,
    changeWatchLater,
  };
}
