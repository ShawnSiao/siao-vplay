import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { PlayerScreen } from "../features/playback/PlayerScreen";
import { DesktopShell } from "../features/shell/DesktopShell";
import type { MediaDropFeedback } from "../features/shell/useDesktopMediaDrop";
import type {
  ShellContextMenu,
  ShellDrawerTab,
} from "../features/shell/useShellController";
import type { MediaPreparation, Project } from "../types";
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
      onOpenUrl={() => undefined}
      onManageSubtitles={() => undefined}
      onManageTranslation={() => undefined}
      onReviseSubtitles={() => undefined}
      onDeliverSubtitles={() => undefined}
    >
      <PlayerScreen
        project={project}
        preparation={preparation}
        currentSubtitle={null}
        currentTranslation={null}
        drawerTab={drawerTab}
        contextMenu={contextMenu}
        onBack={() => undefined}
        onCloseDrawer={() => setDrawerTab(null)}
        onSelectDrawer={setDrawerTab}
        onOpenContextMenu={setContextMenu}
        onCloseContextMenu={() => setContextMenu(null)}
        onManageSubtitles={() => undefined}
        onNeedProxy={() => undefined}
        onPersist={async () => undefined}
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
