import { useLibraryMutation } from "./useLibraryMutation";
import { useLibraryRecoveryApply } from "./useLibraryRecoveryApply";
import { useLibraryRecoveryPreview } from "./useLibraryRecoveryPreview";
import { useLibraryFolderImport } from "./useLibraryFolderImport";
import { useLibraryFolderScan } from "./useLibraryFolderScan";
import { useLibrarySearch, type LibrarySearchAction } from "./useLibrarySearch";
import { useLibraryCollectionPaging, type CollectionReadAction } from "./useLibraryCollectionPaging";
import { useLibraryWatchActions, type WatchAction } from "./useLibraryWatchActions";
import { applyWatchedProject } from "./applyWatchedProject";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { commandError } from "../../lib/desktop";
import type {
  CollectionDetail,
  CollectionSortMode,
  LibraryCollection,
  LibraryHome,
  LibraryImportResult,
  LibraryMediaSummary,
  LibraryRescanPreview,
  LibraryRescanResult,
  LibraryRootRebuildPreview,
  LibraryRootRebuildResult,
  LibraryRootRelocationPreview,
  LibraryRootRelocationResult,
  LibraryScanPreview,
  LibraryScanProgress,
  LibrarySearchResult,
} from "../../types";
import {
  addProjectToCollection,
  createCollection,
  deleteCollection,
  emptyLibraryHome,
  getLibraryHome,
  removeProjectFromCollection,
  revokeLibraryRoot,
  toCollectionSummary,
  updateCollection,
} from "./libraryGateway";
import {
  emptySectionPages,
  saveLibrarySection,
  reduceSectionPages,
  removeUnclassifiedProject,
  sectionsFromHome,
  storedLibrarySection,
  type LibrarySection,
  type LibrarySectionAction,
  type LibrarySectionPages,
} from "./librarySectionState";
import { useLibrarySectionPaging } from "./useLibrarySectionPaging";
import {
  type LibraryImportDraftItem,
} from "./libraryImportDraft";

export type {
  LibrarySection,
  LibrarySectionPages,
  LibrarySectionPageState,
} from "./librarySectionState";
export type { LibraryImportDraftItem } from "./libraryImportDraft";
export { importItemNeedsConfirmation } from "./libraryImportDraft";

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
  sectionPages: LibrarySectionPages;
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
  | WatchAction
  | { type: "home_started" }
  | { type: "home_loaded"; home: LibraryHome; sequence: number }
  | { type: "failed"; message: string }
  | { type: "set_section"; section: LibrarySection }
  | LibrarySectionAction
  | CollectionReadAction
  | { type: "close_collection" }
  | { type: "set_search_query"; query: string }
  | LibrarySearchAction
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

function initialState(): LibraryState {
  return {
    home: emptyLibraryHome,
    loading: true,
    error: null,
    section: storedLibrarySection(),
    sectionPages: emptySectionPages(),
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
}

function libraryReducer(state: LibraryState, action: LibraryAction): LibraryState {
  switch (action.type) {
    case "watch_state_changed":
      return applyWatchedProject(state, action.project);
    case "home_started":
      return { ...state, loading: true };
    case "home_loaded": {
      return {
        ...state,
        home: action.home,
        sectionPages: sectionsFromHome(state.sectionPages, action.home),
        loading: false,
        error: null,
        refreshSequence: action.sequence,
      };
    }
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
        collectionLoading: false,
        section: action.section,
        currentCollection: null,
        currentEpisodes: [],
        selectedSeason: null,
      };
    case "section_page_started":
    case "section_page_loaded":
    case "section_page_failed":
      return {
        ...state,
        sectionPages: reduceSectionPages(state.sectionPages, action),
      };
    case "section_page_remove":
      return { ...state, sectionPages: reduceSectionPages(state.sectionPages, action) };
    case "collection_window_loaded":
      return state.currentCollection?.summary.id === action.collectionId && state.selectedSeason === action.season
        ? { ...state, currentEpisodes: action.episodes } : state;
    case "collection_started":
      return { ...state, collectionLoading: true };
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
        collectionLoading: false,
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
          ].filter((item) => item.systemKey === null).slice(0, 4),
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
          watchLaterCount: action.detail.summary.systemKey === "watch_later" ? action.detail.summary.itemCount : state.home.watchLaterCount,
          collections: [
            action.detail.summary,
            ...state.home.collections.filter(
              (item) => item.id !== action.detail.summary.id,
            ),
          ].filter((item) => item.systemKey === null).slice(0, 4),
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
    case "remove_unclassified": {
      const next = removeUnclassifiedProject(
        state.home,
        state.sectionPages,
        action.projectId,
      );
      return {
        ...state,
        sectionPages: next.pages,
        home: next.home,
      };
    }
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
          ].filter((item) => item.systemKey === null).slice(0, 4),
          folders: ([
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
          ] satisfies LibraryHome["folders"]).slice(0, 4),
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
          folders: ([
            action.result.root,
            ...state.home.folders.filter((root) => root.id !== action.result.root.id),
          ] satisfies LibraryHome["folders"]).slice(0, 4),
          collections: [
            action.result.collection.summary,
            ...state.home.collections.filter(
              (collection) => collection.id !== action.result.collection.summary.id,
            ),
          ].filter((item) => item.systemKey === null).slice(0, 4),
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
          folders: ([
            action.result.root,
            ...state.home.folders.filter((root) => root.id !== action.result.root.id),
          ] satisfies LibraryHome["folders"]).slice(0, 4),
          collections: [
            action.result.collection.summary,
            ...state.home.collections.filter(
              (collection) => collection.id !== action.result.collection.summary.id,
            ),
          ].filter((item) => item.systemKey === null).slice(0, 4),
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
          folders: ([
            action.result.root,
            ...state.home.folders.filter((root) => root.id !== action.result.root.id),
          ] satisfies LibraryHome["folders"]).slice(0, 4),
        },
      };
    case "recovery_closed":
      return { ...state, recovery: emptyRecovery };
  }
}

export function useLibraryController() {
  const [state, dispatch] = useReducer(libraryReducer, initialState());
  const homeRequestSequence = useRef(0);
  const collectionRequestSequence = useRef(0);

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

  const { loadSectionPage, loadMoreSection, loadPreviousSection, retrySection } = useLibrarySectionPaging(
    state.section,
    state.sectionPages,
    dispatch,
  );

  useLibrarySearch(state.searchQuery, dispatch);

  const { loadCollection, collectionPagination } = useLibraryCollectionPaging(state, dispatch, collectionRequestSequence);

  const runMutation = useLibraryMutation(dispatch, refresh);

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
    (collectionId: string, projectId: string) => {
      const viewSequence = collectionRequestSequence.current;
      return runMutation(
        () => removeProjectFromCollection(collectionId, projectId),
        (detail) => {
          dispatch({ type: "upsert_detail", detail });
          if (collectionRequestSequence.current === viewSequence && state.currentCollection?.summary.id === collectionId) {
            void loadCollection(collectionId, state.selectedSeason);
          }
        },
      );
    },
    [loadCollection, runMutation, state.currentCollection?.summary.id, state.selectedSeason],
  );

  const { changeWatchLater, changeWatched } = useLibraryWatchActions(runMutation, dispatch);

  const setSection = useCallback((section: LibrarySection) => {
    collectionRequestSequence.current += 1;
    saveLibrarySection(section);
    dispatch({ type: "set_section", section });
  }, []);
  const setSearchQuery = useCallback((query: string) => {
    dispatch({ type: "set_search_query", query });
  }, []);
  const closeCollection = useCallback(() => {
    collectionRequestSequence.current += 1;
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

  const { startFolderScan, closeFolderImport, cancelFolderScan } = useLibraryFolderScan(dispatch);

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

  const importScannedFolder = useLibraryFolderImport(state.folderImport, {
    started: () => dispatch({ type: "scan_import_started" }),
    committed: async (result, source) => {
      dispatch({ type: "scan_import_succeeded", result, episodes: [],
        importedRootPath: source.rootPath, importedRootName: source.rootDisplayName });
      await loadCollection(result.collection.summary.id, null, result.collection);
      void refresh();
    },
    failed: message => dispatch({ type: "scan_failed", message }),
    refreshFailed: message => dispatch({ type: "failed", message }),
  });
  const { inspectRootRescan, inspectRootRebuild, inspectRootRelocation, closeRecovery } = useLibraryRecoveryPreview(dispatch);

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

  const { applyRescan, applyRebuild, applyRootRelocation } = useLibraryRecoveryApply(state.recovery, {
    started: () => dispatch({ type: "recovery_applying" }),
    rescanCommitted: async result => { dispatch({ type: "rescan_succeeded", result }); void refresh(); },
    rebuildCommitted: async result => {
      dispatch({ type: "rebuild_succeeded", result, episodes: [] });
      await loadCollection(result.collection.summary.id, null, result.collection);
      void refresh();
    },
    relocationCommitted: async result => { dispatch({ type: "relocation_succeeded", result }); void refresh(); },
    failed: message => dispatch({ type: "recovery_failed", message }),
    refreshFailed: message => dispatch({ type: "failed", message }),
  });

  const setRebuildCollectionTitle = useCallback((title: string) => {
    dispatch({ type: "rebuild_title_changed", title });
  }, []);

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
    loadSectionPage,
    loadMoreSection,
    loadPreviousSection, retrySection,
    setSearchQuery,
    openCollection: loadCollection,
    collectionPagination,
    closeCollection,
    selectSeason,
    createManualCollection,
    editCollection,
    removeCollection,
    addToCollection,
    removeFromCollection,
    changeWatchLater,
    changeWatched,
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
