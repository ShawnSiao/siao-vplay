import { useSectionWindowPreview } from "./useSectionWindowPreview";
import { homeCount, homeMatrixItems, homeMatrixSearch, recordHomeSelection } from "./libraryHomeMatrix";
import { collectionPickerFixture } from "./collectionPickerFixture";
import { rootOverviewFixture } from "./rootOverviewFixture";
import { useLibraryPagesPreview } from "./useLibraryPagesPreview";
import { ActivityPreview } from "./ActivityPreview";
import { ProjectCleanupNotice } from "../components/ProjectCleanupNotice";
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
import { emptyLibraryHome, offlineRecovery } from "./libraryHarnessData";
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
const longListMode = new URLSearchParams(location.search).has("long-list");
const listCountParam = new URLSearchParams(location.search).get("mediaCount");
const loadedListCount = listCountParam === "1000" || listCountParam === "10000" ? Number(listCountParam) : 0;
const unclassifiedItems = Array.from({ length: homeCount ?? (loadedListCount || (longListMode ? 20 : 12)) }, (_, index) => ({
  ...mediaSummary,
  projectId: `e2e-library-project-${index + 1}`,
  projectTitle: longListMode ? `第 ${index + 1} 集 ${"很长的视频名称与跨语言学习内容".repeat(12)}` : `雨站台 ${index + 1}`,
  displayName: longListMode ? `${"long_unbroken_filename_".repeat(14)}${index + 1}.mp4` : `rain-platform-${index + 1}.mp4`,
  mediaLocator: `W:\\Videos\\rain-platform-${index + 1}.mp4`,
}));

const libraryHome: LibraryHome = {
  continueWatching: [mediaSummary],
  continueWatchingCount: 1,
  collectionCount: 1, folderCount: 1, watchLaterCount: 0,
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

const readCollections = collectionPickerFixture(libraryHome.collections[0]);
const readRoots = rootOverviewFixture(libraryHome.folders[0]);
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

export function LibraryHarness() {
  const sectionWindow = useSectionWindowPreview(mediaSummary);
  const collectionPreview = useLibraryPagesPreview();
  const [searchQuery, setSearchQuery] = useState("");
  const emptyMode = homeCount === 0 || new URLSearchParams(window.location.search).has("empty");
  const [folderImport, setFolderImport] = useState<LibraryFolderImportState | null>(null); const [section, setSection] = useState<LibrarySection>(homeCount !== null ? "home" : sectionWindow ? sectionWindow.initialSection : loadedListCount ? (new URLSearchParams(location.search).get("section") === "watch_later" ? "watch_later" : "unclassified") : longListMode ? "unclassified" : "home");
  const [recovery, setRecovery] = useState<LibraryRecoveryState | null>(null);
  const [watchLaterItems, setWatchLaterItems] = useState(loadedListCount ? unclassifiedItems : [mediaSummary]);
  const [uncategorizedItems, setUncategorizedItems] = useState(unclassifiedItems);
  const openFolderImport = () => setFolderImport(folderPreview);
  const visibleHome: LibraryHome = emptyMode ? emptyLibraryHome : { ...libraryHome, unclassified: uncategorizedItems, unclassifiedCount: uncategorizedItems.length,
    ...homeMatrixItems(uncategorizedItems) };
  return (
    <>
      <DesktopShell
      activeView="library"
      navigationCollapsed={false}
      drawerTab={null}
      dropFeedback={null}
      appStatus={{
        appName: "SiaoVPlay", interruptedTranscriptionCount: 0,
        version: "test",
        platform: "browser-test",
        dataDirectory: "",
        startupMediaPath: null,
      }}
      localResourceStatus={{
        snapshotRevision: 1,
        configured: true,
        selectedParent: "W:\\SiaoVPlay",
        resourceRoot: "W:\\SiaoVPlay\\LocalResources",
        rootState: "ready",
        freeSpaceBytes: 500_000_000_000,
        preferredProfile: "standard",
        capabilities: [
          {
            id: "basic_media",
            title: "基础视频支持",
            state: "ready",
            requiredResourceIds: ["ffmpeg-cpu"],
            missingResourceIds: [],
          },
        ],
      }}
      previewMode
      mediaTitle={null}
      currentSubtitleCount={null}
      currentTranslationCount={null}
      canReviseSubtitles={false}
      canDeliverSubtitles={false}
      libraryCounts={{
        continueWatching: emptyMode ? 0 : 1,
        episodeFiles: emptyMode ? 0 : 1,
        series: emptyMode ? 0 : 1,
        folders: emptyMode ? 0 : 1,
        watchLater: emptyMode ? 0 : watchLaterItems.length,
        unclassified: emptyMode ? 0 : uncategorizedItems.length,
      }}
      librarySection={section}
      searchQuery={searchQuery}
      searchResults={homeMatrixSearch(uncategorizedItems, searchQuery)}
      searchLoading={false}
      onToggleNavigation={() => undefined}
      onToggleDrawer={() => undefined}
      onGoLibrary={() => undefined}
      onSelectLibrarySection={setSection}
      onSearchQueryChange={setSearchQuery}
      onOpenSearchResult={recordHomeSelection}
      activityControl={new URLSearchParams(location.search).has("activity") ? <ActivityPreview /> : undefined}
      onOpenFile={() => undefined}
      onOpenFolder={openFolderImport}
      onOpenUrl={() => undefined}
      onManageSubtitles={() => undefined}
      onManageTranslation={() => undefined}
      onReviseSubtitles={() => undefined}
      onDeliverSubtitles={() => undefined}
      onOpenSettings={() => undefined}
    >
      {new URLSearchParams(location.search).has("cleanup") ? <ProjectCleanupNotice revision={0} /> : null}
      <LibraryScreen
        readCollections={readCollections}
        readRoots={readRoots}
        home={visibleHome}
        section={section}
        sectionPages={sectionWindow?.pages ?? {
          continue_watching: {
            items: libraryHome.continueWatching,
            totalCount: libraryHome.continueWatching.length,
            nextOffset: null,
            initialized: true,
            loading: false,
            loadingMore: false,
            error: null,
          },
          watch_later: {
            items: watchLaterItems, totalCount: watchLaterItems.length,
            nextOffset: null, initialized: true,
            loading: false, loadingMore: false, error: null,
          },
          unclassified: {
            items: uncategorizedItems,
            totalCount: uncategorizedItems.length,
            nextOffset: null,
            initialized: true,
            loading: false,
            loadingMore: false,
            error: null,
          },
        }}
        {...collectionPreview}
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
        onLoadMoreSection={sectionWindow?.loadMore ?? (async () => false)}
        onPreviousSection={sectionWindow?.previous}
        onRetrySectionPage={sectionWindow?.retry}
        onReloadSection={sectionWindow?.reload ?? (() => undefined)}
        onOpenCollection={() => undefined}
        onCloseCollection={() => undefined}
        onSelectSeason={() => undefined}
        onCreateCollection={async () => undefined}
        onUpdateCollection={async () => undefined}
        onDeleteCollection={async () => null}
        onAddToCollection={async (_collectionId, projectId) => {
          setUncategorizedItems((items) => items.filter((item) => item.projectId !== projectId));
        }}
        onRemoveFromCollection={async () => undefined}
        onSetWatched={async (projectId, watched) => {
          const update = (items: LibraryMediaSummary[]) => items.map(item => item.projectId === projectId ? { ...item, completedAtMs: watched ? Date.now() : null } : item);
          setUncategorizedItems(update); setWatchLaterItems(update);
        }}
        onSetWatchLater={async (projectId, enabled) => {
          if (enabled) {
            const item = uncategorizedItems.find((candidate) => candidate.projectId === projectId);
            if (item) {
              setWatchLaterItems((items) => [...items, item]);
              setUncategorizedItems((items) => items.filter((candidate) => candidate.projectId !== projectId));
            }
          } else {
            setWatchLaterItems((items) => items.filter((item) => item.projectId !== projectId));
          }
        }}
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
