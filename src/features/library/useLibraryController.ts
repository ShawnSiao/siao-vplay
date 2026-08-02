import { useCallback, useEffect, useReducer, useRef } from "react";

import { commandError } from "../../lib/desktop";
import type {
  CollectionDetail,
  CollectionSortMode,
  ConfirmLibraryImportInput,
  EpisodeRecognition,
  LibraryCollection,
  LibraryHome,
  LibraryImportResult,
  LibraryMediaSummary,
  LibraryRescanPreview,
  LibraryRescanResult,
  ApplyLibraryRootRebuildInput,
  LibraryRootRebuildPreview,
  LibraryRootRebuildResult,
  LibraryRootRelocationPreview,
  LibraryRootRelocationResult,
  LibraryScanCandidate,
  LibraryScanPreview,
  LibraryScanProgress,
  LibrarySearchResult,
} from "../../types";
import {
  addProjectToCollection,
  applyLibraryRescan,
  applyLibraryRootRebuild,
  applyLibraryRootRelocation,
  cancelLibraryScan,
  confirmLibraryImport,
  createCollection,
  deleteCollection,
  emptyLibraryHome,
  getCollectionDetail,
  getLibraryHome,
  inspectLibraryRescan,
  inspectLibraryRootRebuild,
  inspectLibraryRootRelocation,
  listCollectionEpisodes,
  listenLibraryScanProgress,
  removeProjectFromCollection,
  revokeLibraryRoot,
  scanLibraryFolder,
  searchLibrary,
  setWatchLater,
  toCollectionSummary,
  updateCollection,
} from "./libraryGateway";

export type LibrarySection =
  | "home"
  | "series"
  | "folders"
  | "watch_later"
  | "unclassified";

export type LibraryImportDraftItem = {
  candidateId: string;
  relativePath: string;
  recognition: EpisodeRecognition;
  confirmationReason: string | null;
  initiallyNeedsConfirmation: boolean;
  originalDisplayTitle: string;
  originalSeasonNumber: number | null;
  originalEpisodeNumber: number | null;
  originalAbsoluteOrder: number;
  displayTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteOrder: number;
  confirmed: boolean;
};

export type LibraryFolderImportState = {
  stage: "closed" | "scanning" | "preview" | "importing";
  scanId: string | null;
  rootPath: string | null;
  progress: LibraryScanProgress | null;
  preview: LibraryScanPreview | null;
  collectionTitle: string;
  items: LibraryImportDraftItem[];
  confirmFingerprintDuplicates: boolean;
  error: string | null;
};

const emptyFolderImport: LibraryFolderImportState = {
  stage: "closed",
  scanId: null,
  rootPath: null,
  progress: null,
  preview: null,
  collectionTitle: "",
  items: [],
  confirmFingerprintDuplicates: false,
  error: null,
};

export type LibraryRecoveryState = {
  stage:
    | "closed"
    | "inspecting_rescan"
    | "rescan_preview"
    | "inspecting_rebuild"
    | "rebuild_preview"
    | "inspecting_relocation"
    | "relocation_preview"
    | "applying"
    | "error";
  rootId: string | null;
  rescanPreview: LibraryRescanPreview | null;
  rebuildPreview: LibraryRootRebuildPreview | null;
  relocationPreview: LibraryRootRelocationPreview | null;
  newItems: LibraryImportDraftItem[];
  rebuildCollectionTitle: string;
  confirmMissing: boolean;
  confirmChanged: boolean;
  confirmUncertainMatches: boolean;
  confirmFingerprintDuplicates: boolean;
  error: string | null;
};

const emptyRecovery: LibraryRecoveryState = {
  stage: "closed",
  rootId: null,
  rescanPreview: null,
  rebuildPreview: null,
  relocationPreview: null,
  newItems: [],
  rebuildCollectionTitle: "",
  confirmMissing: false,
  confirmChanged: false,
  confirmUncertainMatches: false,
  confirmFingerprintDuplicates: false,
  error: null,
};

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
  folderImport: LibraryFolderImportState;
  recovery: LibraryRecoveryState;
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
  | { type: "remove_root"; rootId: string }
  | { type: "remove_unclassified"; projectId: string }
  | { type: "scan_started"; scanId: string; rootPath: string }
  | { type: "scan_progress"; progress: LibraryScanProgress }
  | {
      type: "scan_preview";
      preview: LibraryScanPreview;
      items: LibraryImportDraftItem[];
    }
  | { type: "scan_title_changed"; title: string }
  | {
      type: "scan_item_changed";
      candidateId: string;
      values: Partial<
        Pick<
          LibraryImportDraftItem,
          | "displayTitle"
          | "seasonNumber"
          | "episodeNumber"
          | "absoluteOrder"
          | "confirmed"
        >
      >;
    }
  | { type: "scan_duplicates_changed"; confirmed: boolean }
  | { type: "scan_import_started" }
  | {
      type: "scan_import_succeeded";
      result: LibraryImportResult;
      episodes: LibraryMediaSummary[];
      importedRootPath: string;
      importedRootName: string;
    }
  | { type: "scan_failed"; message: string }
  | { type: "scan_closed" }
  | {
      type: "recovery_started";
      stage: "inspecting_rescan" | "inspecting_rebuild" | "inspecting_relocation";
      rootId: string;
    }
  | {
      type: "rescan_preview";
      preview: LibraryRescanPreview;
      items: LibraryImportDraftItem[];
    }
  | {
      type: "rebuild_preview";
      preview: LibraryRootRebuildPreview;
      items: LibraryImportDraftItem[];
    }
  | { type: "relocation_preview"; preview: LibraryRootRelocationPreview }
  | { type: "rebuild_title_changed"; title: string }
  | {
      type: "recovery_item_changed";
      candidateId: string;
      values: Partial<
        Pick<
          LibraryImportDraftItem,
          | "displayTitle"
          | "seasonNumber"
          | "episodeNumber"
          | "absoluteOrder"
          | "confirmed"
        >
      >;
    }
  | {
      type: "recovery_confirmation_changed";
      field:
        | "confirmMissing"
        | "confirmChanged"
        | "confirmUncertainMatches"
        | "confirmFingerprintDuplicates";
      checked: boolean;
    }
  | { type: "recovery_applying" }
  | { type: "recovery_failed"; message: string }
  | { type: "rescan_succeeded"; result: LibraryRescanResult }
  | { type: "rebuild_succeeded"; result: LibraryRootRebuildResult; episodes: LibraryMediaSummary[] }
  | { type: "relocation_succeeded"; result: LibraryRootRelocationResult }
  | { type: "recovery_closed" };

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
  folderImport: emptyFolderImport,
  recovery: emptyRecovery,
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
    case "scan_started":
      return {
        ...state,
        folderImport: {
          ...emptyFolderImport,
          stage: "scanning",
          scanId: action.scanId,
          rootPath: action.rootPath,
        },
      };
    case "scan_progress":
      return {
        ...state,
        folderImport: {
          ...state.folderImport,
          progress: action.progress,
        },
      };
    case "scan_preview":
      return {
        ...state,
        folderImport: {
          ...state.folderImport,
          stage: "preview",
          preview: action.preview,
          progress: {
            scanId: action.preview.scanId,
            phase: "completed",
            scannedDirectories: state.folderImport.progress?.scannedDirectories ?? 0,
            scannedFiles: state.folderImport.progress?.scannedFiles ?? 0,
            candidateFiles: action.preview.candidates.length,
            ignoredEntries: action.preview.ignoredCount,
            currentRelativePath: null,
            message: null,
          },
          collectionTitle: action.preview.suggestedCollectionTitle,
          items: action.items,
          error: null,
        },
      };
    case "scan_title_changed":
      return {
        ...state,
        folderImport: { ...state.folderImport, collectionTitle: action.title },
      };
    case "scan_item_changed":
      return {
        ...state,
        folderImport: {
          ...state.folderImport,
          items: state.folderImport.items.map((item) =>
            item.candidateId === action.candidateId
              ? { ...item, ...action.values }
              : item,
          ),
        },
      };
    case "scan_duplicates_changed":
      return {
        ...state,
        folderImport: {
          ...state.folderImport,
          confirmFingerprintDuplicates: action.confirmed,
        },
      };
    case "scan_import_started":
      return {
        ...state,
        folderImport: { ...state.folderImport, stage: "importing", error: null },
      };
    case "scan_import_succeeded": {
      const createdProjects = action.result.createdProjectCount;
      const importedItems = action.result.importedItemCount;
      return {
        ...state,
        section: "series",
        currentCollection: action.result.collection,
        currentEpisodes: action.episodes,
        selectedSeason: null,
        collectionLoading: false,
        folderImport: emptyFolderImport,
        home: {
          ...state.home,
          collections: [
            action.result.collection.summary,
            ...state.home.collections.filter(
              (collection) => collection.id !== action.result.collection.summary.id,
            ),
          ],
          folders: [
            {
              id: action.result.rootId,
              path: action.importedRootPath,
              displayName: action.importedRootName,
              availability: "available",
              status: "linked",
              lastScannedAtMs: Date.now(),
              itemCount: importedItems,
            },
            ...state.home.folders.filter((folder) => folder.id !== action.result.rootId),
          ],
          totalProjectCount: state.home.totalProjectCount + createdProjects,
          collectionItemCount: state.home.collectionItemCount + importedItems,
        },
      };
    }
    case "scan_failed":
      return {
        ...state,
        folderImport: {
          ...state.folderImport,
          stage: state.folderImport.preview ? "preview" : "scanning",
          error: action.message,
        },
      };
    case "scan_closed":
      return { ...state, folderImport: emptyFolderImport };
    case "recovery_started":
      return {
        ...state,
        recovery: {
          ...emptyRecovery,
          stage: action.stage,
          rootId: action.rootId,
        },
      };
    case "rescan_preview":
      return {
        ...state,
        recovery: {
          ...state.recovery,
          stage: "rescan_preview",
          rescanPreview: action.preview,
          newItems: action.items,
          error: null,
        },
      };
    case "remove_root":
      return {
        ...state,
        home: {
          ...state.home,
          folders: state.home.folders.filter((root) => root.id !== action.rootId),
        },
      };
    case "rebuild_preview":
      return {
        ...state,
        recovery: {
          ...state.recovery,
          stage: "rebuild_preview",
          rebuildPreview: action.preview,
          rebuildCollectionTitle: action.preview.suggestedCollectionTitle,
          newItems: action.items,
          error: null,
        },
      };
    case "relocation_preview":
      return {
        ...state,
        recovery: {
          ...state.recovery,
          stage: "relocation_preview",
          relocationPreview: action.preview,
          error: null,
        },
      };
    case "rebuild_title_changed":
      return {
        ...state,
        recovery: { ...state.recovery, rebuildCollectionTitle: action.title },
      };
    case "recovery_item_changed":
      return {
        ...state,
        recovery: {
          ...state.recovery,
          newItems: state.recovery.newItems.map((item) =>
            item.candidateId === action.candidateId
              ? { ...item, ...action.values }
              : item,
          ),
        },
      };
    case "recovery_confirmation_changed":
      return {
        ...state,
        recovery: { ...state.recovery, [action.field]: action.checked },
      };
    case "recovery_applying":
      return {
        ...state,
        recovery: { ...state.recovery, stage: "applying", error: null },
      };
    case "recovery_failed":
      return {
        ...state,
        recovery: {
          ...state.recovery,
          stage: state.recovery.rescanPreview
            ? "rescan_preview"
            : state.recovery.rebuildPreview
              ? "rebuild_preview"
            : state.recovery.relocationPreview
              ? "relocation_preview"
              : "error",
          error: action.message,
        },
      };
    case "rescan_succeeded": {
      const added = action.result.addedItemCount;
      return {
        ...state,
        recovery: emptyRecovery,
        currentCollection:
          state.currentCollection?.summary.id === action.result.collection.summary.id
            ? action.result.collection
            : state.currentCollection,
        home: {
          ...state.home,
          folders: [
            action.result.root,
            ...state.home.folders.filter((root) => root.id !== action.result.root.id),
          ],
          collections: [
            action.result.collection.summary,
            ...state.home.collections.filter(
              (collection) => collection.id !== action.result.collection.summary.id,
            ),
          ],
          totalProjectCount:
            state.home.totalProjectCount + action.result.createdProjectCount,
          collectionItemCount: state.home.collectionItemCount + added,
        },
      };
    }
    case "rebuild_succeeded": {
      const added = action.result.addedItemCount;
      return {
        ...state,
        section: "series",
        currentCollection: action.result.collection,
        currentEpisodes: action.episodes,
        selectedSeason: null,
        recovery: emptyRecovery,
        home: {
          ...state.home,
          folders: [
            action.result.root,
            ...state.home.folders.filter((root) => root.id !== action.result.root.id),
          ],
          collections: [
            action.result.collection.summary,
            ...state.home.collections.filter(
              (collection) => collection.id !== action.result.collection.summary.id,
            ),
          ],
          totalProjectCount:
            state.home.totalProjectCount + action.result.createdProjectCount,
          collectionItemCount: state.home.collectionItemCount + added,
        },
      };
    }
    case "relocation_succeeded":
      return {
        ...state,
        recovery: emptyRecovery,
        home: {
          ...state.home,
          folders: [
            action.result.root,
            ...state.home.folders.filter((root) => root.id !== action.result.root.id),
          ],
        },
      };
    case "recovery_closed":
      return { ...state, recovery: emptyRecovery };
  }
}

function draftCandidateItems(
  candidates: LibraryScanCandidate[],
): LibraryImportDraftItem[] {
  return candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    relativePath: candidate.relativePath,
    recognition: candidate.recognition,
    confirmationReason: candidate.confirmationReason,
    initiallyNeedsConfirmation: candidate.needsConfirmation,
    originalDisplayTitle: candidate.displayTitle,
    originalSeasonNumber: candidate.seasonNumber,
    originalEpisodeNumber: candidate.episodeNumber,
    originalAbsoluteOrder: candidate.absoluteOrder,
    displayTitle: candidate.displayTitle,
    seasonNumber: candidate.seasonNumber,
    episodeNumber: candidate.episodeNumber,
    absoluteOrder: candidate.absoluteOrder,
    confirmed: false,
  }));
}

function draftItems(preview: LibraryScanPreview): LibraryImportDraftItem[] {
  return draftCandidateItems(preview.candidates);
}

export function importItemNeedsConfirmation(item: LibraryImportDraftItem): boolean {
  return (
    item.initiallyNeedsConfirmation ||
    item.displayTitle.trim() !== item.originalDisplayTitle ||
    item.seasonNumber !== item.originalSeasonNumber ||
    item.episodeNumber !== item.originalEpisodeNumber ||
    item.absoluteOrder !== item.originalAbsoluteOrder
  );
}

export function useLibraryController() {
  const [state, dispatch] = useReducer(libraryReducer, initialState);
  const homeRequestSequence = useRef(0);
  const collectionRequestSequence = useRef(0);
  const searchRequestSequence = useRef(0);
  const scanRequestSequence = useRef(0);
  const recoveryRequestSequence = useRef(0);
  const activeScanIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let stopListening: (() => void) | null = null;
    void listenLibraryScanProgress((progress) => {
      if (active && activeScanIdRef.current === progress.scanId) {
        dispatch({ type: "scan_progress", progress });
      }
    }).then((unlisten) => {
      if (active) {
        stopListening = unlisten;
      } else {
        unlisten();
      }
    }).catch(() => {
      // Progress events are supplemental; the scan command still returns its
      // authoritative preview when the event channel is unavailable.
    });
    return () => {
      active = false;
      stopListening?.();
    };
  }, []);

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

  const startFolderScan = useCallback(async (rootPath: string) => {
    const sequence = scanRequestSequence.current + 1;
    scanRequestSequence.current = sequence;
    const scanId = crypto.randomUUID();
    activeScanIdRef.current = scanId;
    dispatch({ type: "scan_started", scanId, rootPath });
    try {
      const preview = await scanLibraryFolder({ scanId, rootPath });
      if (scanRequestSequence.current === sequence) {
        activeScanIdRef.current = null;
        dispatch({ type: "scan_preview", preview, items: draftItems(preview) });
      }
      return preview;
    } catch (error) {
      if (scanRequestSequence.current === sequence) {
        activeScanIdRef.current = null;
        dispatch({ type: "scan_failed", message: commandError(error).message });
      }
      return null;
    }
  }, []);

  const closeFolderImport = useCallback(() => {
    const scanId = activeScanIdRef.current;
    scanRequestSequence.current += 1;
    activeScanIdRef.current = null;
    dispatch({ type: "scan_closed" });
    if (scanId) {
      void cancelLibraryScan(scanId).catch(() => undefined);
    }
  }, []);

  const cancelFolderScan = useCallback(async () => {
    const scanId = activeScanIdRef.current;
    scanRequestSequence.current += 1;
    activeScanIdRef.current = null;
    dispatch({ type: "scan_closed" });
    if (scanId) {
      try {
        await cancelLibraryScan(scanId);
      } catch {
        // The scan may have completed between the click and the cancel command.
      }
    }
  }, []);

  const setFolderImportTitle = useCallback((title: string) => {
    dispatch({ type: "scan_title_changed", title });
  }, []);

  const updateFolderImportItem = useCallback(
    (
      candidateId: string,
      values: Partial<
        Pick<
          LibraryImportDraftItem,
          | "displayTitle"
          | "seasonNumber"
          | "episodeNumber"
          | "absoluteOrder"
          | "confirmed"
        >
      >,
    ) => {
      dispatch({ type: "scan_item_changed", candidateId, values });
    },
    [],
  );

  const setConfirmFingerprintDuplicates = useCallback((confirmed: boolean) => {
    dispatch({ type: "scan_duplicates_changed", confirmed });
  }, []);

  const importScannedFolder = useCallback(async () => {
    const snapshot = state.folderImport;
    if (!snapshot.preview || snapshot.stage !== "preview") {
      return null;
    }
    const input: ConfirmLibraryImportInput = {
      previewToken: snapshot.preview.previewToken,
      collectionTitle: snapshot.collectionTitle,
      items: snapshot.items.map((item) => ({
        candidateId: item.candidateId,
        displayTitle: item.displayTitle,
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        absoluteOrder: item.absoluteOrder,
        confirmed: item.confirmed,
      })),
      confirmFingerprintDuplicates: snapshot.confirmFingerprintDuplicates,
    };
    dispatch({ type: "scan_import_started" });
    try {
      const result = await confirmLibraryImport(input);
      let episodes: LibraryMediaSummary[] = [];
      try {
        episodes = await listCollectionEpisodes(
          result.collection.summary.id,
          null,
        );
      } catch {
        // The import transaction already succeeded and consumed its preview
        // token. A secondary read must not turn that success into a retryable
        // import error; the background home refresh will reconcile the view.
      }
      dispatch({
        type: "scan_import_succeeded",
        result,
        episodes,
        importedRootPath: snapshot.preview.rootPath,
        importedRootName: snapshot.preview.rootDisplayName,
      });
      void refresh();
      return result;
    } catch (error) {
      dispatch({ type: "scan_failed", message: commandError(error).message });
      return null;
    }
  }, [refresh, state.folderImport]);

  const inspectRootRescan = useCallback(async (rootId: string) => {
    const sequence = recoveryRequestSequence.current + 1;
    recoveryRequestSequence.current = sequence;
    dispatch({ type: "recovery_started", stage: "inspecting_rescan", rootId });
    try {
      const preview = await inspectLibraryRescan(rootId);
      if (recoveryRequestSequence.current === sequence) {
        dispatch({
          type: "rescan_preview",
          preview,
          items: draftCandidateItems(preview.newCandidates),
        });
      }
      return preview;
    } catch (error) {
      if (recoveryRequestSequence.current === sequence) {
        dispatch({ type: "recovery_failed", message: commandError(error).message });
      }
      return null;
    }
  }, []);

  const inspectRootRebuild = useCallback(
    async (rootId: string, newRootPath: string | null = null) => {
      const sequence = recoveryRequestSequence.current + 1;
      recoveryRequestSequence.current = sequence;
      dispatch({ type: "recovery_started", stage: "inspecting_rebuild", rootId });
      try {
        const preview = await inspectLibraryRootRebuild({ rootId, newRootPath });
        if (recoveryRequestSequence.current === sequence) {
          dispatch({
            type: "rebuild_preview",
            preview,
            items: draftCandidateItems(preview.newCandidates),
          });
        }
        return preview;
      } catch (error) {
        if (recoveryRequestSequence.current === sequence) {
          dispatch({ type: "recovery_failed", message: commandError(error).message });
        }
        return null;
      }
    },
    [],
  );

  const inspectRootRelocation = useCallback(
    async (rootId: string, newRootPath: string) => {
      const sequence = recoveryRequestSequence.current + 1;
      recoveryRequestSequence.current = sequence;
      dispatch({ type: "recovery_started", stage: "inspecting_relocation", rootId });
      try {
        const preview = await inspectLibraryRootRelocation(rootId, newRootPath);
        if (recoveryRequestSequence.current === sequence) {
          dispatch({ type: "relocation_preview", preview });
        }
        return preview;
      } catch (error) {
        if (recoveryRequestSequence.current === sequence) {
          dispatch({ type: "recovery_failed", message: commandError(error).message });
        }
        return null;
      }
    },
    [],
  );

  const closeRecovery = useCallback(() => {
    recoveryRequestSequence.current += 1;
    dispatch({ type: "recovery_closed" });
  }, []);

  const updateRecoveryItem = useCallback(
    (
      candidateId: string,
      values: Partial<
        Pick<
          LibraryImportDraftItem,
          | "displayTitle"
          | "seasonNumber"
          | "episodeNumber"
          | "absoluteOrder"
          | "confirmed"
        >
      >,
    ) => dispatch({ type: "recovery_item_changed", candidateId, values }),
    [],
  );

  const setRecoveryConfirmation = useCallback(
    (
      field:
        | "confirmMissing"
        | "confirmChanged"
        | "confirmUncertainMatches"
        | "confirmFingerprintDuplicates",
      checked: boolean,
    ) => dispatch({ type: "recovery_confirmation_changed", field, checked }),
    [],
  );

  const applyRescan = useCallback(async () => {
    const snapshot = state.recovery;
    if (!snapshot.rescanPreview || snapshot.stage !== "rescan_preview") {
      return null;
    }
    dispatch({ type: "recovery_applying" });
    try {
      const result = await applyLibraryRescan({
        previewToken: snapshot.rescanPreview.previewToken,
        newItems: snapshot.newItems.map((item) => ({
          candidateId: item.candidateId,
          displayTitle: item.displayTitle,
          seasonNumber: item.seasonNumber,
          episodeNumber: item.episodeNumber,
          absoluteOrder: item.absoluteOrder,
          confirmed: item.confirmed,
        })),
        confirmMissing: snapshot.confirmMissing,
        confirmChanged: snapshot.confirmChanged,
        confirmFingerprintDuplicates: snapshot.confirmFingerprintDuplicates,
      });
      dispatch({ type: "rescan_succeeded", result });
      void refresh();
      return result;
    } catch (error) {
      dispatch({ type: "recovery_failed", message: commandError(error).message });
      return null;
    }
  }, [refresh, state.recovery]);

  const setRebuildCollectionTitle = useCallback((title: string) => {
    dispatch({ type: "rebuild_title_changed", title });
  }, []);

  const applyRebuild = useCallback(async () => {
    const snapshot = state.recovery;
    if (!snapshot.rebuildPreview || snapshot.stage !== "rebuild_preview") {
      return null;
    }
    const input: ApplyLibraryRootRebuildInput = {
      previewToken: snapshot.rebuildPreview.previewToken,
      collectionTitle: snapshot.rebuildCollectionTitle,
      newItems: snapshot.newItems.map((item) => ({
        candidateId: item.candidateId,
        displayTitle: item.displayTitle,
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        absoluteOrder: item.absoluteOrder,
        confirmed: item.confirmed,
      })),
      confirmMissing: snapshot.confirmMissing,
      confirmChanged: snapshot.confirmChanged,
      confirmUncertainMatches: snapshot.confirmUncertainMatches,
      confirmFingerprintDuplicates: snapshot.confirmFingerprintDuplicates,
    };
    dispatch({ type: "recovery_applying" });
    try {
      const result = await applyLibraryRootRebuild(input);
      let episodes: LibraryMediaSummary[] = [];
      try {
        episodes = await listCollectionEpisodes(result.collection.summary.id, null);
      } catch {
        // The rebuild transaction already succeeded; refresh below reconciles the home view.
      }
      dispatch({ type: "rebuild_succeeded", result, episodes });
      void refresh();
      return result;
    } catch (error) {
      dispatch({ type: "recovery_failed", message: commandError(error).message });
      return null;
    }
  }, [refresh, state.recovery]);

  const applyRootRelocation = useCallback(async () => {
    const snapshot = state.recovery;
    if (!snapshot.relocationPreview || snapshot.stage !== "relocation_preview") {
      return null;
    }
    dispatch({ type: "recovery_applying" });
    try {
      const result = await applyLibraryRootRelocation(
        snapshot.relocationPreview.previewToken,
      );
      dispatch({ type: "relocation_succeeded", result });
      void refresh();
      return result;
    } catch (error) {
      dispatch({ type: "recovery_failed", message: commandError(error).message });
      return null;
    }
  }, [refresh, state.recovery]);

  const revokeRoot = useCallback(
    (rootId: string) =>
      runMutation(
        () => revokeLibraryRoot(rootId),
        (result) => dispatch({ type: "remove_root", rootId: result.rootId }),
      ),
    [runMutation],
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
    startFolderScan,
    cancelFolderScan,
    closeFolderImport,
    setFolderImportTitle,
    updateFolderImportItem,
    setConfirmFingerprintDuplicates,
    importScannedFolder,
    inspectRootRescan,
    inspectRootRebuild,
    inspectRootRelocation,
    closeRecovery,
    updateRecoveryItem,
    setRecoveryConfirmation,
    setRebuildCollectionTitle,
    applyRescan,
    applyRebuild,
    applyRootRelocation,
    revokeRoot,
  };
}
