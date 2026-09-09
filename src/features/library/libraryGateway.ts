import { readLibrarySection } from "../../lib/libraryPageGateway";
import { readLibraryHome } from "../../lib/libraryHomeGateway";
import { readLibrarySearch } from "../../lib/librarySearchGateway";
import { invokeCollectionDetail, invokeWatchLater } from "../../lib/collectionDetailGateway";
import { invokeCollectionMutation, invokeCollectionDeletion } from "../../lib/collectionMutationGateway";
import { readCollectionEpisodes } from "../../lib/collectionEpisodesGateway";
import { readEpisodeNeighbors } from "../../lib/episodeNeighborsGateway";
import { subscribeLibraryScanProgress } from "../../lib/libraryScanProgressGateway";
import { readLibraryScanPreview } from "../../lib/libraryScanPreviewGateway";
import { invokeProject } from "../../lib/projectGateway";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { isDesktopApp } from "../../lib/desktop";
import type {
  Project,
  ApplyLibraryRescanInput,
  ApplyLibraryRootRebuildInput,
  CollectionDetail,
  ConfirmLibraryImportInput,
  CollectionSortMode,
  CollectionSummary,
  EpisodeNeighbors,
  LibraryCollection,
  LibraryCollectionDeletionResult,
  LibraryHome,
  LibraryMediaSummary,
  LibraryMediaSection,
  LibrarySectionPage,
  ListLibrarySectionInput,
  LibraryScanPreview,
  LibraryScanProgress,
  LibraryImportResult,
  LibraryRescanPreview,
  LibraryRescanResult,
  LibraryRootRebuildPreview,
  LibraryRootRebuildResult,
  LibraryRootRevokeResult,
  LibraryRootRelocationPreview,
  LibraryRootRelocationResult,
  InspectLibraryRootRebuildInput,
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
  continueWatchingCount: 0,
  collections: [],
  folders: [],
  unclassified: [],
  recentlyAdded: [],
  totalProjectCount: 0,
  collectionItemCount: 0,
  unclassifiedCount: 0,
};

export async function getLibraryHome(): Promise<LibraryHome> {
  if (!isDesktopApp) {
    return emptyLibraryHome;
  }
  return readLibraryHome();
}

export async function listLibrarySection(
  section: LibraryMediaSection,
  offset: number,
): Promise<LibrarySectionPage> {
  if (!isDesktopApp) {
    return { items: [], totalCount: 0, nextOffset: null };
  }
  const input: ListLibrarySectionInput = { section, offset };
  return readLibrarySection(input);
}

export async function searchLibrary(query: string): Promise<LibrarySearchResult[]> {
  if (!isDesktopApp) {
    return [];
  }
  return readLibrarySearch(query);
}

export async function createCollection(
  input: CreateCollectionInput,
): Promise<LibraryCollection> {
  return invokeCollectionMutation("create_collection", input);
}

export async function updateCollection(
  input: UpdateCollectionInput,
): Promise<LibraryCollection> {
  return invokeCollectionMutation("update_collection", input, input.collectionId);
}

export async function deleteCollection(
  collectionId: string,
): Promise<LibraryCollectionDeletionResult> {
  return invokeCollectionDeletion(collectionId);
}

export async function getCollectionDetail(
  collectionId: string,
): Promise<CollectionDetail> {
  return invokeCollectionDetail("get_collection_detail", { collectionId }, collectionId);
}

export async function listCollectionEpisodes(
  collectionId: string,
  seasonNumber: number | null,
): Promise<LibraryMediaSummary[]> {
  return readCollectionEpisodes(collectionId, seasonNumber);
}

export async function addProjectToCollection(
  input: AddProjectToCollectionInput,
): Promise<CollectionDetail> {
  return invokeCollectionDetail("add_project_to_collection", { input }, input.collectionId);
}

export async function removeProjectFromCollection(
  collectionId: string,
  projectId: string,
): Promise<CollectionDetail> {
  return invokeCollectionDetail("remove_project_from_collection", {
    collectionId,
    projectId,
  }, collectionId);
}

export async function getEpisodeNeighbors(
  collectionId: string,
  projectId: string,
): Promise<EpisodeNeighbors> {
  return readEpisodeNeighbors(collectionId, projectId);
}

export async function setWatchLater(
  projectId: string,
  enabled: boolean,
): Promise<CollectionDetail | null> {
  return invokeWatchLater(projectId, enabled);
}

export async function setProjectWatched(projectId: string, watched: boolean): Promise<Project> {
  return invokeProject("set_project_watched", { projectId, watched });
}

export async function scanLibraryFolder(
  input: ScanLibraryFolderInput,
): Promise<LibraryScanPreview> {
  return readLibraryScanPreview(input);
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
  return subscribeLibraryScanProgress(onProgress);
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

export async function inspectLibraryRootRebuild(
  input: InspectLibraryRootRebuildInput,
): Promise<LibraryRootRebuildPreview> {
  return invoke<LibraryRootRebuildPreview>("inspect_library_root_rebuild", { input });
}

export async function applyLibraryRootRebuild(
  input: ApplyLibraryRootRebuildInput,
): Promise<LibraryRootRebuildResult> {
  return invoke<LibraryRootRebuildResult>("apply_library_root_rebuild", { input });
}

export async function revokeLibraryRoot(
  rootId: string,
): Promise<LibraryRootRevokeResult> {
  return invoke<LibraryRootRevokeResult>("revoke_library_root", { rootId });
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
