import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { PlayerScreen } from "../features/playback/PlayerScreen";
import { DesktopShell } from "../features/shell/DesktopShell";
import type { MediaDropFeedback } from "../features/shell/useDesktopMediaDrop";
import type {
  ShellContextMenu,
  ShellDrawerTab,
} from "../features/shell/useShellController";
import type {
  CollectionDetail,
  EpisodeReference,
  LibraryMediaSummary,
  MediaPreparation,
  Project,
} from "../types";
import "../styles.css";

const project: Project = {
  id: "e2e-project",
  title: "交互测试视频",
  status: "ready",
  revision: 1,
  createdAtMs: 1,
  updatedAtMs: 1,
  lastOpenedAtMs: 1,
  mediaSource: {
    id: "e2e-source",
    kind: "local_file",
    locator: "fixture.mp4",
    originUrl: null,
    displayName: "fixture.mp4",
    isAvailable: true,
    sourceSha256: null,
    probedAtMs: 1,
    posterPath: null,
    createdAtMs: 1,
    updatedAtMs: 1,
  },
  playbackState: {
    positionMs: 15_000,
    durationMs: 120_000,
    completedAtMs: null,
    volume: 0.8,
    playbackRate: 1,
    subtitleMode: "original",
    updatedAtMs: 1,
  },
};

const preparation: MediaPreparation = {
  inspection: {
    projectId: project.id,
    mediaSourceId: project.mediaSource.id,
    sourceSha256: "a".repeat(64),
    probe: {
      containerFormats: ["mp4"],
      durationMs: 120_000,
      sizeBytes: 8_000_000,
      bitRate: 1_000_000,
      videoStreams: [
        {
          index: 0,
          codecName: "h264",
          profile: "High",
          pixelFormat: "yuv420p",
          width: 1920,
          height: 1080,
          frameRate: 30,
          durationMs: 120_000,
        },
      ],
      audioStreams: [
        {
          index: 1,
          codecName: "aac",
          channels: 2,
          sampleRateHz: 48_000,
          durationMs: 120_000,
        },
      ],
      subtitleStreams: [],
    },
    playbackGate: {
      decision: "direct",
      reasonCodes: ["test"],
      requiresRuntimeVideoCheck: false,
    },
    ffmpegVersion: "test",
    reusedProbe: false,
  },
  playbackSourceKind: "original",
  playbackPath: "fixture.mp4",
  proxyArtifact: null,
  reusedProxy: false,
};

const collectionDetail: CollectionDetail = {
  summary: {
    id: "e2e-series",
    kind: "series",
    title: "雨夜列车",
    rootId: "e2e-root",
    systemKey: null,
    posterPath: null,
    sortMode: "episode",
    autoPlayNext: false,
    lastOpenedAtMs: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    itemCount: 2,
    seasonCount: 1,
    watchedCount: 0,
    totalDurationMs: 240_000,
  },
  seasons: [{ seasonNumber: 1, episodeCount: 2, watchedCount: 0, totalDurationMs: 240_000 }],
};

function episodeSummary(
  projectId: string,
  episodeNumber: number,
  title: string,
): LibraryMediaSummary {
  return {
    projectId,
    projectTitle: title,
    displayName: `${String(episodeNumber).padStart(2, "0")}.mp4`,
    mediaLocator: `${String(episodeNumber).padStart(2, "0")}.mp4`,
    mediaAvailable: true,
    posterPath: null,
    positionMs: projectId === project.id ? 15_000 : 0,
    durationMs: 120_000,
    completedAtMs: null,
    lastOpenedAtMs: 1,
    createdAtMs: 1,
    originalSubtitleAvailable: true,
    chineseTranslationAvailable: false,
    collectionId: collectionDetail.summary.id,
    collectionTitle: collectionDetail.summary.title,
    seasonNumber: 1,
    episodeNumber,
    absoluteOrder: episodeNumber - 1,
    episodeTitle: title,
    itemAvailability: "available",
  };
}

const nextEpisode: EpisodeReference = {
  projectId: "e2e-project-next",
  displayTitle: "驶入雨幕",
  seasonNumber: 1,
  episodeNumber: 2,
  absoluteOrder: 1,
};

function requestedDropFeedback(): MediaDropFeedback | null {
  const drop = new URLSearchParams(window.location.search).get("drop");
  return drop === "ready"
    ? { tone: "ready", message: "松开以导入这个视频" }
    : null;
}

export function PlayerHarness() {
  const [drawerTab, setDrawerTab] = useState<ShellDrawerTab | null>(null);
  const [contextMenu, setContextMenu] = useState<ShellContextMenu | null>(null);

  const toggleDrawer = (tab: ShellDrawerTab) => {
    setDrawerTab((current) => (current === tab ? null : tab));
    setContextMenu(null);
  };

  return (
    <DesktopShell
      activeView="player"
      navigationCollapsed
      drawerTab={drawerTab}
      dropFeedback={requestedDropFeedback()}
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
      mediaTitle={project.title}
      currentSubtitleCount={null}
      currentTranslationCount={null}
      canReviseSubtitles={false}
      canDeliverSubtitles={false}
      libraryCounts={{
        continueWatching: 1,
        episodeFiles: 0,
        series: 0,
        folders: 0,
        watchLater: 0,
        unclassified: 1,
      }}
      librarySection="home"
      searchQuery=""
      searchResults={[]}
      searchLoading={false}
      onToggleNavigation={() => undefined}
      onToggleDrawer={toggleDrawer}
      onGoLibrary={() => undefined}
      onSelectLibrarySection={() => undefined}
      onSearchQueryChange={() => undefined}
      onOpenSearchResult={() => undefined}
      onOpenFile={() => undefined}
      onOpenFolder={() => undefined}
      onOpenUrl={() => undefined}
      onManageSubtitles={() => undefined}
      onManageTranslation={() => undefined}
      onReviseSubtitles={() => undefined}
      onDeliverSubtitles={() => undefined}
      onOpenSettings={() => undefined}
    >
      <PlayerScreen
        project={project}
        preparation={preparation}
        currentSubtitle={null}
        currentTranslation={null}
        drawerTab={drawerTab}
        contextMenu={contextMenu}
        episodeNavigation={{
          detail: collectionDetail,
          episodes: [
            episodeSummary(project.id, 1, "站台相遇"),
            episodeSummary(nextEpisode.projectId, 2, nextEpisode.displayTitle),
          ],
          neighbors: { previous: null, next: nextEpisode },
          loading: false,
          error: null,
        }}
        onBack={() => undefined}
        onCloseDrawer={() => setDrawerTab(null)}
        onSelectDrawer={setDrawerTab}
        onOpenContextMenu={setContextMenu}
        onCloseContextMenu={() => setContextMenu(null)}
        onManageSubtitles={() => undefined}
        onNeedProxy={() => undefined}
        onPersist={async () => undefined}
        onSwitchEpisode={async () => undefined}
        onError={() => undefined}
      />
    </DesktopShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlayerHarness />
  </StrictMode>,
);
