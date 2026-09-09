import { createPlayerSubtitleFixtures } from "./playerSubtitleFixtures";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { PlayerScreen } from "../features/playback/PlayerScreen";
import { UnderstandingResultView } from "../features/analysis/UnderstandingResultView";
import { renderFeaturePreview } from "./playerFeaturePreview";
import { DesktopShell } from "../features/shell/DesktopShell";
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
import { createUnderstandingFixtures } from "../test-fixtures/understanding";
import "../styles.css";
import "../features/summary/summary.css";
import "../features/summary/summary-results.css";
import "./playerHarness.css";
import {
  configurePlayerHarnessValidation,
  requestedDropFeedback,
} from "./playerHarnessValidation";

const subtitleScriptSample = configurePlayerHarnessValidation();

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
    subtitleMode: "bilingual",
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

const { originalSubtitle, translatedSubtitle } = createPlayerSubtitleFixtures(project.id);

if (subtitleScriptSample) {
  originalSubtitle.segments[0].text = subtitleScriptSample.original;
  originalSubtitle.segments[0].words = [];
  translatedSubtitle.segments[0].text = subtitleScriptSample.translation;
}

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

function UnderstandingResultPreview() {
  const [factsExpanded, setFactsExpanded] = useState(false);
  const [interpretationsExpanded, setInterpretationsExpanded] = useState(false);
  const { explanation } = createUnderstandingFixtures({
    projectId: project.id,
    sourceVersionId: originalSubtitle.id,
    translationVersionId: translatedSubtitle.id,
    sourceSegmentId: originalSubtitle.segments[0].id,
  });
  const entries = Array.from({ length: 6 }, (_, index) => ({
    text: `第 ${index + 1} 条带依据的分析内容。`,
    subtitleSegmentIds: [originalSubtitle.segments[0].id],
    frameIds: index % 2 === 0 ? ["16e2210a-62e4-4df8-a0cc-25a9c218f998"] : [],
  }));
  return (
    <main className="understanding-preview">
      <section className="understanding-panel embedded" aria-label="场景理解">
        <div className="understanding-scroll">
          <div className="spoiler-boundary"><span>无剧透范围</span><strong>仅使用 00:15 之前</strong></div>
          <UnderstandingResultView
            explanation={{
              ...explanation,
              playbackCutoffMs: 15_000,
              materialSummary: { ...explanation.materialSummary, endMs: 15_000 },
              confirmedFacts: entries,
              possibleInterpretations: entries,
            }}
            factsExpanded={factsExpanded}
            interpretationsExpanded={interpretationsExpanded}
            onFactsExpandedChange={setFactsExpanded}
            onInterpretationsExpandedChange={setInterpretationsExpanded}
            onAnalyzeAgain={() => undefined}
          />
        </div>
      </section>
    </main>
  );
}

export function PlayerHarness() {
  const pagedEpisodes = new URLSearchParams(window.location.search).has("episodePages");
  const countParam = new URLSearchParams(window.location.search).get("episodeCount");
  const accumulatedCount = countParam === "1000" || countParam === "10000" ? Number(countParam) : 0;
  const [loadedMore, setLoadedMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [pageAttempt, setPageAttempt] = useState(0);
  const episodeItems = accumulatedCount ? Array.from({ length: accumulatedCount }, (_, index) => episodeSummary(index === 0 ? project.id : `episode-${index + 1}`, index + 1, `第 ${index + 1} 集`)) : [episodeSummary(project.id, 1, "站台相遇"), episodeSummary(nextEpisode.projectId, 2, nextEpisode.displayTitle)]
    .slice(0, pagedEpisodes && !loadedMore ? 1 : 2);

  const [drawerTab, setDrawerTab] = useState<ShellDrawerTab | null>(null);
  const [contextMenu, setContextMenu] = useState<ShellContextMenu | null>(null);

  const featurePreview = renderFeaturePreview(new URLSearchParams(window.location.search), originalSubtitle, project);
  if (featurePreview) return featurePreview;

  if (new URLSearchParams(window.location.search).get("understanding") === "result") {
    return <UnderstandingResultPreview />;
  }

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
        currentSubtitle={originalSubtitle}
        currentTranslation={translatedSubtitle}
        drawerTab={drawerTab}
        contextMenu={contextMenu}
        episodeNavigation={{
          detail: accumulatedCount ? { ...collectionDetail, summary: { ...collectionDetail.summary, itemCount: accumulatedCount } } : collectionDetail,
          episodes: episodeItems,
          neighbors: { previous: null, next: nextEpisode },
          loading: false,
          error: null,
        }}
        episodePagination={pagedEpisodes ? {
          items: episodeItems, totalCount: accumulatedCount || 2, nextOffset: accumulatedCount || loadedMore ? null : 1, loading: false,
          error: pageError ? "读取暂时失败" : null,
          loadMore: async () => { if (pageAttempt === 0) { setPageError(true); setPageAttempt(1); return false; } else { setLoadedMore(true); setPageError(false); return true; } },
          reload: () => { setLoadedMore(false); setPageError(false); setPageAttempt(0); },
        } : undefined}
        onBack={() => undefined}
        onCloseDrawer={() => setDrawerTab(null)}
        onSelectDrawer={setDrawerTab}
        onOpenContextMenu={setContextMenu}
        onCloseContextMenu={() => setContextMenu(null)}
        onManageSubtitles={() => undefined}
        onNeedProxy={() => undefined}
        onPersist={async (values) => {
          const state = window as unknown as { playbackSaves?: unknown[] };
          (state.playbackSaves ??= []).push(values);
        }}
        onSwitchEpisode={async () => undefined}
        onNotice={() => undefined}
        onRetryPlayback={() => undefined}
      />
    </DesktopShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlayerHarness />
  </StrictMode>,
);
