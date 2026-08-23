import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { PlayerScreen } from "../features/playback/PlayerScreen";
import { UnderstandingResultView } from "../features/analysis/UnderstandingResultView";
import { LearningSpeechPreview } from "./LearningSpeechPreview";
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
  SubtitleVersion,
} from "../types";
import { createUnderstandingFixtures } from "../test-fixtures/understanding";
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

const originalSubtitle: SubtitleVersion = {
  id: "e2e-original",
  trackId: "e2e-original-track",
  projectId: project.id,
  role: "original",
  versionNumber: 1,
  status: "ready",
  sourceKind: "transcription",
  sourceLabel: "交互测试转写",
  sourceSha256: "b".repeat(64),
  mediaSha256: "a".repeat(64),
  languageCode: "en",
  projectRevision: 1,
  parentVersionId: null,
  sourceTaskId: null,
  preflight: {} as SubtitleVersion["preflight"],
  createdAtMs: 1,
  isCurrent: true,
  segments: [{
    id: "e2e-original-segment",
    lineageId: "e2e-original-segment",
    sourceSegmentId: null,
    issueKind: null,
    ordinal: 0,
    startMs: 14_000,
    endMs: 18_000,
    text: "Okay, and that's essentially how the system stores the new memories.",
    confidence: 0.95,
    words: [
      { ordinal: 0, startMs: 14_000, endMs: 14_300, text: "okay", confidence: 0.95 },
      { ordinal: 1, startMs: 14_300, endMs: 14_500, text: ",", confidence: 0.95 },
      { ordinal: 2, startMs: 14_500, endMs: 14_800, text: "and", confidence: 0.95 },
      { ordinal: 3, startMs: 14_800, endMs: 15_300, text: "essentially", confidence: 0.95 },
      { ordinal: 4, startMs: 15_300, endMs: 15_600, text: "how", confidence: 0.95 },
      { ordinal: 5, startMs: 15_600, endMs: 15_850, text: "the", confidence: 0.95 },
      { ordinal: 6, startMs: 15_850, endMs: 16_250, text: "system", confidence: 0.95 },
      { ordinal: 7, startMs: 16_250, endMs: 16_650, text: "stores", confidence: 0.95 },
      { ordinal: 8, startMs: 16_650, endMs: 16_900, text: "the", confidence: 0.95 },
      { ordinal: 9, startMs: 16_900, endMs: 17_200, text: "new", confidence: 0.95 },
      { ordinal: 10, startMs: 17_200, endMs: 17_800, text: "memories", confidence: 0.95 },
      { ordinal: 11, startMs: 17_800, endMs: 18_000, text: ".", confidence: 0.95 },
    ],
  }],
};

const translatedSubtitle: SubtitleVersion = {
  ...originalSubtitle,
  id: "e2e-translation",
  trackId: "e2e-translation-track",
  role: "translation",
  sourceKind: "agent_translation",
  sourceLabel: "交互测试翻译",
  sourceSha256: "c".repeat(64),
  languageCode: "zh-cn",
  segments: [{
    ...originalSubtitle.segments[0],
    id: "e2e-translation-segment",
    lineageId: "e2e-translation-segment",
    sourceSegmentId: originalSubtitle.segments[0].id,
    text: "这句话会跟随每一个单词。",
    words: [],
  }],
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
  const [drawerTab, setDrawerTab] = useState<ShellDrawerTab | null>(null);
  const [contextMenu, setContextMenu] = useState<ShellContextMenu | null>(null);

  if (new URLSearchParams(window.location.search).get("understanding") === "result") {
    return <UnderstandingResultPreview />;
  }
  if (new URLSearchParams(window.location.search).get("learning") === "speech") {
    return <LearningSpeechPreview />;
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
