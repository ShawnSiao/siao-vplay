import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LibraryScreen } from "../components/LibraryScreen";
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
  folders: [],
  unclassified: [mediaSummary],
  totalProjectCount: 1,
  collectionItemCount: 0,
  unclassifiedCount: 1,
};

export function LibraryHarness() {
  return (
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
        folders: 0,
        watchLater: 0,
        unclassified: 1,
      }}
      librarySection="home"
      searchQuery=""
      searchResults={[]}
      searchLoading={false}
      onToggleNavigation={() => undefined}
      onToggleDrawer={() => undefined}
      onGoLibrary={() => undefined}
      onSelectLibrarySection={() => undefined}
      onSearchQueryChange={() => undefined}
      onOpenSearchResult={() => undefined}
      onOpenFile={() => undefined}
      onOpenUrl={() => undefined}
      onManageSubtitles={() => undefined}
      onManageTranslation={() => undefined}
      onReviseSubtitles={() => undefined}
      onDeliverSubtitles={() => undefined}
    >
      <LibraryScreen
        home={libraryHome}
        section="home"
        currentCollection={null}
        currentEpisodes={[]}
        selectedSeason={null}
        loading={false}
        collectionLoading={false}
        mutationPending={false}
        error={null}
        previewMode
        onImport={() => undefined}
        onImportUrl={() => undefined}
        onOpen={() => undefined}
        onRelink={() => undefined}
        onDelete={() => undefined}
        onSelectSection={() => undefined}
        onOpenCollection={() => undefined}
        onCloseCollection={() => undefined}
        onSelectSeason={() => undefined}
        onCreateCollection={async () => undefined}
        onUpdateCollection={async () => undefined}
        onDeleteCollection={async () => undefined}
        onAddToCollection={async () => undefined}
        onRemoveFromCollection={async () => undefined}
        onSetWatchLater={async () => undefined}
      />
    </DesktopShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LibraryHarness />
  </StrictMode>,
);
