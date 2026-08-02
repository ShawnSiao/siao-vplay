import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { LibraryFolderImportDialog } from "../components/LibraryFolderImportDialog";
import { LibraryRecoveryDialog } from "../components/LibraryRecoveryDialog";
import { LibraryScreen } from "../components/LibraryScreen";
import type {
  LibraryFolderImportState,
  LibraryImportDraftItem,
  LibraryRecoveryState,
  LibrarySection,
} from "../features/library/useLibraryController";
import { DesktopShell } from "../features/shell/DesktopShell";
import type { LibraryHome, LibraryMediaSummary, Project } from "../types";
import "../styles.css";

const project: Project = {
  id: "e2e-library-project",
  title: "雨站台",
  status: "ready",
  revision: 1,
  createdAtMs: Date.now() - 86_400_000,
  updatedAtMs: Date.now(),
  lastOpenedAtMs: Date.now(),
  mediaSource: {
    id: "e2e-library-source",
    kind: "local_file",
    locator: "rain-platform.mp4",
    originUrl: null,
    displayName: "rain-platform.mp4",
    isAvailable: true,
    sourceSha256: null,
    probedAtMs: Date.now(),
    posterPath: null,
    createdAtMs: Date.now() - 86_400_000,
    updatedAtMs: Date.now(),
  },
  playbackState: {
    positionMs: 42_000,
    durationMs: 180_000,
    completedAtMs: null,
    volume: 0.8,
    playbackRate: 1,
    subtitleMode: "bilingual",
    updatedAtMs: Date.now(),
  },
};

const mediaSummary: LibraryMediaSummary = {
  projectId: project.id,
  projectTitle: project.title,
  displayName: project.mediaSource.displayName,
  mediaLocator: project.mediaSource.locator,
  mediaAvailable: true,
  posterPath: null,
  positionMs: project.playbackState.positionMs,
  durationMs: project.playbackState.durationMs,
  completedAtMs: null,
  lastOpenedAtMs: project.lastOpenedAtMs,
  createdAtMs: project.createdAtMs,
  originalSubtitleAvailable: true,
  chineseTranslationAvailable: true,
  collectionId: null,
  collectionTitle: null,
  seasonNumber: null,
  episodeNumber: null,
  absoluteOrder: null,
  episodeTitle: null,
  itemAvailability: null,
};

const unclassifiedItems = Array.from({ length: 12 }, (_, index) => ({
  ...mediaSummary,
  projectId: `e2e-library-project-${index + 1}`,
  projectTitle: `雨站台 ${index + 1}`,
  displayName: `rain-platform-${index + 1}.mp4`,
  mediaLocator: `W:\\Videos\\rain-platform-${index + 1}.mp4`,
}));

const libraryHome: LibraryHome = {
  continueWatching: [mediaSummary],
  collections: [
    {
      id: "e2e-library-collection",
      kind: "manual",
      title: "周末电影",
      rootId: null,
      systemKey: null,
      posterPath: null,
      sortMode: "manual",
      autoPlayNext: false,
      lastOpenedAtMs: Date.now(),
      createdAtMs: Date.now() - 86_400_000,
      updatedAtMs: Date.now(),
      itemCount: 12,
      seasonCount: 0,
      watchedCount: 4,
      totalDurationMs: 12 * 45 * 60 * 1_000,
    },
  ],
  folders: [{
    id: "e2e-library-root",
    path: "W:\\Series\\Rain",
    displayName: "Rain",
    availability: "available",
    status: "linked",
    lastScannedAtMs: Date.now(),
    itemCount: 3,
  }],
  unclassified: unclassifiedItems,
  recentlyAdded: [mediaSummary],
  totalProjectCount: unclassifiedItems.length,
  collectionItemCount: 0,
  unclassifiedCount: unclassifiedItems.length,
};

const unresolvedItem: LibraryImportDraftItem = {
  candidateId: "e2e-folder-candidate",
  relativePath: "Special.mp4",
  recognition: "unresolved",
  confirmationReason: "没有识别到明确集号",
  initiallyNeedsConfirmation: true,
  originalDisplayTitle: "Special",
  originalSeasonNumber: null,
  originalEpisodeNumber: null,
  originalAbsoluteOrder: 0,
  displayTitle: "Special",
  seasonNumber: null,
  episodeNumber: null,
  absoluteOrder: 0,
  confirmed: false,
};

const folderPreview: LibraryFolderImportState = {
  stage: "preview",
  scanId: "e2e-folder-scan",
  rootPath: "W:\\Series\\Special",
  progress: null,
  preview: {
    scanId: "e2e-folder-scan",
    previewToken: "e2e-folder-preview",
    rootPath: "W:\\Series\\Special",
    rootDisplayName: "Special",
    suggestedCollectionTitle: "Special",
    candidates: [{
      candidateId: unresolvedItem.candidateId,
      relativePath: unresolvedItem.relativePath,
      displayTitle: unresolvedItem.displayTitle,
      seasonNumber: unresolvedItem.seasonNumber,
      episodeNumber: unresolvedItem.episodeNumber,
      absoluteOrder: unresolvedItem.absoluteOrder,
      recognition: unresolvedItem.recognition,
      needsConfirmation: true,
      confirmationReason: unresolvedItem.confirmationReason,
      sourceSizeBytes: 8_000_000,
      sourceModifiedAtMs: 1,
      quickFingerprint: "e2e-fingerprint",
    }],
    ignoredEntries: [],
    ignoredCount: 2,
    needsConfirmationCount: 1,
    expiresAtMs: 1_900_000_000_000,
  },
  collectionTitle: "Special",
  items: [unresolvedItem],
  confirmFingerprintDuplicates: false,
  error: null,
};

const offlineRecovery: LibraryRecoveryState = {
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

export function LibraryHarness() {
  const [folderImport, setFolderImport] = useState<LibraryFolderImportState | null>(null);
  const [section, setSection] = useState<LibrarySection>("home");
  const [recovery, setRecovery] = useState<LibraryRecoveryState | null>(null);
  const openFolderImport = () => setFolderImport(folderPreview);
  return (
    <>
      <DesktopShell
      activeView="library"
      navigationCollapsed={false}
      drawerTab={null}
      dropFeedback={null}
      appStatus={{
        appName: "SiaoVPlay",
        version: "test",
        platform: "browser-test",
        dataDirectory: "",
        startupMediaPath: null,
      }}
      runtimeStatus={{
        available: true,
        ffmpegPath: null,
        ffprobePath: null,
        version: "test",
        errorMessage: null,
      }}
      previewMode
      mediaTitle={null}
      currentSubtitleCount={null}
      currentTranslationCount={null}
      canReviseSubtitles={false}
      canDeliverSubtitles={false}
      libraryCounts={{
        continueWatching: 1,
        episodeFiles: 1,
        series: 1,
        folders: 1,
        watchLater: 0,
        unclassified: 1,
      }}
      librarySection={section}
      searchQuery=""
      searchResults={[]}
      searchLoading={false}
      onToggleNavigation={() => undefined}
      onToggleDrawer={() => undefined}
      onGoLibrary={() => undefined}
      onSelectLibrarySection={setSection}
      onSearchQueryChange={() => undefined}
      onOpenSearchResult={() => undefined}
      onOpenFile={() => undefined}
      onOpenFolder={openFolderImport}
      onOpenUrl={() => undefined}
      onManageSubtitles={() => undefined}
      onManageTranslation={() => undefined}
      onReviseSubtitles={() => undefined}
      onDeliverSubtitles={() => undefined}
      onOpenSettings={() => undefined}
    >
      <LibraryScreen
        home={libraryHome}
        section={section}
        currentCollection={null}
        currentEpisodes={[]}
        selectedSeason={null}
        loading={false}
        collectionLoading={false}
        mutationPending={false}
        error={null}
        previewMode
        onImport={() => undefined}
        onImportFolder={openFolderImport}
        onImportUrl={() => undefined}
        onRescanRoot={() => setRecovery(offlineRecovery)}
        onRelocateRoot={() => setRecovery({
          ...offlineRecovery,
          stage: "relocation_preview",
          rescanPreview: null,
          relocationPreview: {
            previewToken: "e2e-relocation-preview",
            rootId: "e2e-library-root",
            currentRootPath: "W:\\Series\\Rain",
            newRootPath: "W:\\Moved\\Rain",
            matchedItemCount: 2,
            mismatches: [{
              projectId: "e2e-missing",
              relativePath: "Rain.S01E03.mp4",
              reason: "missing",
            }],
            expiresAtMs: 1_900_000_000_000,
          },
        })}
        onRebuildRoot={() => undefined}
        onRevokeRoot={() => undefined}
        onOpen={() => undefined}
        onRelink={() => undefined}
        onDelete={() => undefined}
        onOpenLocation={() => undefined}
        onSelectSection={setSection}
        onOpenCollection={() => undefined}
        onCloseCollection={() => undefined}
        onSelectSeason={() => undefined}
        onCreateCollection={async () => undefined}
        onUpdateCollection={async () => undefined}
        onDeleteCollection={async () => null}
        onAddToCollection={async () => undefined}
        onRemoveFromCollection={async () => undefined}
        onSetWatchLater={async () => undefined}
      />
      </DesktopShell>
      {folderImport ? (
        <LibraryFolderImportDialog
          state={folderImport}
          onClose={() => setFolderImport(null)}
          onCancelScan={async () => setFolderImport(null)}
          onTitleChange={(collectionTitle) =>
            setFolderImport((current) => current ? { ...current, collectionTitle } : current)
          }
          onItemChange={(candidateId, values) =>
            setFolderImport((current) => current ? {
              ...current,
              items: current.items.map((item) => item.candidateId === candidateId ? { ...item, ...values } : item),
            } : current)
          }
          onConfirmFingerprintDuplicatesChange={(confirmFingerprintDuplicates) =>
            setFolderImport((current) => current ? { ...current, confirmFingerprintDuplicates } : current)
          }
          onImport={async () => setFolderImport(null)}
        />
      ) : null}
      {recovery ? (
        <LibraryRecoveryDialog
          state={recovery}
          onClose={() => setRecovery(null)}
          onItemChange={() => undefined}
          onConfirmationChange={(field, checked) =>
            setRecovery((current) => current ? { ...current, [field]: checked } : current)
          }
          onRebuildTitleChange={() => undefined}
          onApplyRescan={async () => setRecovery(null)}
          onApplyRebuild={async () => setRecovery(null)}
          onApplyRelocation={async () => setRecovery(null)}
        />
      ) : null}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LibraryHarness />
  </StrictMode>,
);
