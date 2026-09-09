import type {
  CollectionDetail,
  LibraryCollection,
  LibraryHome,
  LibraryMediaSummary,
  LibraryScanPreview,
} from "../../types";

export function libraryHome(totalProjectCount: number): LibraryHome {
  return {
    continueWatching: [],
    continueWatchingCount: 0,
    collectionCount: 0, folderCount: 0, watchLaterCount: 0,
    collections: [],
    folders: [],
    unclassified: [],
    recentlyAdded: [],
    totalProjectCount,
    collectionItemCount: 0,
    unclassifiedCount: totalProjectCount,
  };
}

export function mediaSummary(projectId: string): LibraryMediaSummary {
  return {
    projectId,
    projectTitle: `视频 ${projectId}`,
    displayName: `${projectId}.mp4`,
    mediaLocator: `W:\\media\\${projectId}.mp4`,
    mediaAvailable: true,
    posterPath: null,
    positionMs: 0,
    durationMs: 10_000,
    completedAtMs: null,
    lastOpenedAtMs: 1,
    createdAtMs: 1,
    originalSubtitleAvailable: false,
    chineseTranslationAvailable: false,
    collectionId: null,
    collectionTitle: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteOrder: null,
    episodeTitle: null,
    itemAvailability: null,
  };
}

export const collection: LibraryCollection = {
  id: "10c4a3b9-75ac-4faf-8672-1c86c7a849cb",
  kind: "manual",
  title: "周末电影",
  rootId: null,
  systemKey: null,
  posterPath: null,
  sortMode: "manual",
  autoPlayNext: false,
  lastOpenedAtMs: null,
  createdAtMs: 1,
  updatedAtMs: 1,
};

export const scanPreview: LibraryScanPreview = {
  scanId: "20000000-0000-4000-8000-000000000001",
  previewToken: "20000000-0000-4000-8000-000000000002",
  rootPath: "W:\\Series\\Rain",
  rootDisplayName: "Rain",
  suggestedCollectionTitle: "Rain",
  candidates: [
    {
      candidateId: "20000000-0000-4000-8000-000000000003",
      relativePath: "Rain.S01E01.mp4",
      displayTitle: "Rain",
      seasonNumber: 1,
      episodeNumber: 1,
      absoluteOrder: 0,
      recognition: "sxx_exx",
      needsConfirmation: false,
      confirmationReason: null,
      sourceSizeBytes: 1024,
      sourceModifiedAtMs: 10,
      quickFingerprint: "a".repeat(64),
    },
  ],
  ignoredEntries: [],
  ignoredCount: 0,
  needsConfirmationCount: 0,
  expiresAtMs: 1_900_000_000_000,
};

export const importedDetail: CollectionDetail = {
  summary: {
    ...collection,
    kind: "series",
    title: "Rain",
    rootId: "20000000-0000-4000-8000-000000000004",
    sortMode: "episode",
    itemCount: 1,
    seasonCount: 1,
    watchedCount: 0,
    totalDurationMs: null,
  },
  seasons: [
    {
      seasonNumber: 1,
      episodeCount: 1,
      watchedCount: 0,
      totalDurationMs: null,
    },
  ],
};
