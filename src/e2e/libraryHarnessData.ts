import type { LibraryRecoveryState } from "../features/library/useLibraryController";
import type { LibraryHome } from "../types";

export const emptyLibraryHome: LibraryHome = {
  continueWatching: [],
  continueWatchingCount: 0,
  collectionCount: 0, folderCount: 0, watchLaterCount: 0,
  collections: [],
  folders: [],
  unclassified: [],
  recentlyAdded: [],
  totalProjectCount: 0,
  collectionItemCount: 0,
  unclassifiedCount: 0,
};

export const offlineRecovery: LibraryRecoveryState = {
  stage: "rescan_preview",
  rootId: "e2e-library-root",
  rescanPreview: {
    previewToken: "e2e-rescan-preview",
    rootId: "e2e-library-root",
    rootPath: "W:\\Series\\Rain",
    rootDisplayName: "Rain",
    collectionId: "e2e-library-collection",
    rootOffline: true,
    newCandidates: [],
    missingItems: [],
    changedItems: [],
    availableItemCount: 0,
    ignoredCount: 0,
    expiresAtMs: 1_900_000_000_000,
  },
  relocationPreview: null,
  rebuildPreview: null,
  newItems: [],
  rebuildCollectionTitle: "",
  confirmMissing: false,
  confirmChanged: false,
  confirmUncertainMatches: false,
  confirmFingerprintDuplicates: false,
  error: null,
};
