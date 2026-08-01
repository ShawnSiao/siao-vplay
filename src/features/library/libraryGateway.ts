import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { isDesktopApp } from "../../lib/desktop";
import type {
  ApplyLibraryRescanInput,
  CollectionDetail,
  ConfirmLibraryImportInput,
  CollectionSortMode,
  CollectionSummary,
  EpisodeNeighbors,
  LibraryCollection,
  LibraryHome,
  LibraryMediaSummary,
  LibraryScanPreview,
  LibraryScanProgress,
  LibraryImportResult,
  LibraryRescanPreview,
  LibraryRescanResult,
  LibraryRootRelocationPreview,
  LibraryRootRelocationResult,
  LibrarySearchResult,
} from "../../types";

export type CreateCollectionInput = {
  title: string;
};

export type UpdateCollectionInput = {
  collectionId: string;
  title?: string;
  sortMode?: CollectionSortMode;
  autoPlayNext?: boolean;
};

export type AddProjectToCollectionInput = {
  collectionId: string;
  projectId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteOrder?: number;
  displayTitle?: string;
};

export type ScanLibraryFolderInput = {
  scanId: string;
  rootPath: string;
};

export const emptyLibraryHome: LibraryHome = {
  continueWatching: [],
  collections: [],
  folders: [],
  unclassified: [],
  totalProjectCount: 0,
  collectionItemCount: 0,
  unclassifiedCount: 0,
};

export async function getLibraryHome(): Promise<LibraryHome> {
  if (!isDesktopApp) {
    return emptyLibraryHome;
  }
  return invoke<LibraryHome>("get_library_home");
}

export async function searchLibrary(query: string): Promise<LibrarySearchResult[]> {
  if (!isDesktopApp) {
    return [];
  }
  return invoke<LibrarySearchResult[]>("search_library", { query });
}

export async function createCollection(
  input: CreateCollectionInput,
): Promise<LibraryCollection> {
  return invoke<LibraryCollection>("create_collection", { input });
}

export async function updateCollection(
  input: UpdateCollectionInput,
): Promise<LibraryCollection> {
  return invoke<LibraryCollection>("update_collection", { input });
}

export async function deleteCollection(collectionId: string): Promise<void> {
  await invoke("delete_collection", { collectionId });
}

export async function getCollectionDetail(
  collectionId: string,
): Promise<CollectionDetail> {
  return invoke<CollectionDetail>("get_collection_detail", { collectionId });
}

export async function listCollectionEpisodes(
  collectionId: string,
  seasonNumber: number | null,
): Promise<LibraryMediaSummary[]> {
  return invoke<LibraryMediaSummary[]>("list_collection_episodes", {
    collectionId,
    seasonNumber,
  });
}

export async function addProjectToCollection(
  input: AddProjectToCollectionInput,
): Promise<CollectionDetail> {
  return invoke<CollectionDetail>("add_project_to_collection", { input });
}

export async function removeProjectFromCollection(
  collectionId: string,
  projectId: string,
): Promise<CollectionDetail> {
  return invoke<CollectionDetail>("remove_project_from_collection", {
    collectionId,
    projectId,
  });
}

export async function getEpisodeNeighbors(
  collectionId: string,
  projectId: string,
): Promise<EpisodeNeighbors> {
  return invoke<EpisodeNeighbors>("get_episode_neighbors", {
    collectionId,
    projectId,
  });
}

export async function setWatchLater(
  projectId: string,
  enabled: boolean,
): Promise<CollectionDetail | null> {
  return invoke<CollectionDetail | null>("set_watch_later", { projectId, enabled });
}

export async function scanLibraryFolder(
  input: ScanLibraryFolderInput,
): Promise<LibraryScanPreview> {
  return invoke<LibraryScanPreview>("scan_library_folder", { input });
}

export async function cancelLibraryScan(scanId: string): Promise<void> {
  await invoke("cancel_library_scan", { scanId });
}

export async function listenLibraryScanProgress(
  onProgress: (progress: LibraryScanProgress) => void,
): Promise<UnlistenFn> {
  if (!isDesktopApp) {
    return () => undefined;
  }
  return listen<LibraryScanProgress>("library-scan-progress", (event) => {
    onProgress(event.payload);
  });
}

export async function confirmLibraryImport(
  input: ConfirmLibraryImportInput,
): Promise<LibraryImportResult> {
  return invoke<LibraryImportResult>("confirm_library_import", { input });
}

export async function inspectLibraryRescan(
  rootId: string,
): Promise<LibraryRescanPreview> {
  return invoke<LibraryRescanPreview>("inspect_library_rescan", { rootId });
}

export async function applyLibraryRescan(
  input: ApplyLibraryRescanInput,
): Promise<LibraryRescanResult> {
  return invoke<LibraryRescanResult>("apply_library_rescan", { input });
}

export async function inspectLibraryRootRelocation(
  rootId: string,
  newRootPath: string,
): Promise<LibraryRootRelocationPreview> {
  return invoke<LibraryRootRelocationPreview>(
    "inspect_library_root_relocation",
    { input: { rootId, newRootPath } },
  );
}

export async function applyLibraryRootRelocation(
  previewToken: string,
): Promise<LibraryRootRelocationResult> {
  return invoke<LibraryRootRelocationResult>("apply_library_root_relocation", {
    input: { previewToken },
  });
}

export async function openProjectMediaLocation(projectId: string): Promise<void> {
  return invoke<void>("open_project_media_location", { projectId });
}

export function toCollectionSummary(collection: LibraryCollection): CollectionSummary {
  return {
    ...collection,
    itemCount: 0,
    seasonCount: 0,
    watchedCount: 0,
    totalDurationMs: null,
  };
}
