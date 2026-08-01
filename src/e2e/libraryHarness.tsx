import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LibraryScreen } from "../components/LibraryScreen";
import { DesktopShell } from "../features/shell/DesktopShell";
import type { Project } from "../types";
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
        episodeFiles: 0,
        series: 0,
        folders: 0,
        watchLater: 0,
        unclassified: 1,
      }}
      onToggleNavigation={() => undefined}
      onToggleDrawer={() => undefined}
      onGoLibrary={() => undefined}
      onOpenFile={() => undefined}
      onOpenUrl={() => undefined}
      onManageSubtitles={() => undefined}
      onManageTranslation={() => undefined}
      onReviseSubtitles={() => undefined}
      onDeliverSubtitles={() => undefined}
    >
      <LibraryScreen
        projects={[project]}
        loading={false}
        error={null}
        previewMode
        onImport={() => undefined}
        onImportUrl={() => undefined}
        onOpen={() => undefined}
        onRelink={() => undefined}
        onDelete={() => undefined}
      />
    </DesktopShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LibraryHarness />
  </StrictMode>,
);
