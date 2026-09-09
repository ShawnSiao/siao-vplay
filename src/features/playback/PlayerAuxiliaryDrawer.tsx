import type { EpisodePagination } from "../library/useCollectionEpisodePages";
import { LearningPanel } from "../../components/LearningPanel";
import { useState } from "react";
import { UnderstandingPanel } from "../../components/UnderstandingPanel";
import type {
  EpisodeReference,
  SubtitleSegment,
  SubtitleVersion,
} from "../../types";
import type { EpisodeNavigationState } from "../library/useEpisodeNavigation";
import type { ShellDrawerTab } from "../shell/useShellController";
import { EpisodeDrawer } from "./EpisodeDrawer";
import { PlayerDrawer } from "./PlayerDrawer";
import { SubtitleTranscriptPanel } from "./SubtitleTranscriptPanel";

type PlayerAuxiliaryDrawerProps = {
  activeTab: ShellDrawerTab | null;
  projectId: string;
  mediaTitle: string;
  contextLabel: string;
  contextStatus: string;
  episodeSummary: string;
  originalVersion: SubtitleVersion | null;
  translatedVersion: SubtitleVersion | null;
  activeOriginal: SubtitleSegment | null;
  activeTranslation: SubtitleSegment | null;
  episodeNavigation: EpisodeNavigationState;
  episodePagination?: EpisodePagination;
  switchingEpisode: boolean;
  positionMs: number;
  durationMs: number | null;
  onSelectTab: (tab: ShellDrawerTab) => void;
  onClose: () => void;
  onSwitchEpisode: (episode: EpisodeReference) => void;
  onManageSubtitles: () => void;
  onSeekTo: (positionMs: number) => void;
  onPausePlayback: () => void;
};

export function PlayerAuxiliaryDrawer({
  activeTab,
  projectId,
  mediaTitle,
  contextLabel,
  contextStatus,
  episodeSummary,
  originalVersion,
  translatedVersion,
  activeOriginal,
  activeTranslation,
  episodeNavigation,
  episodePagination,
  switchingEpisode,
  positionMs,
  durationMs,
  onSelectTab,
  onClose,
  onSwitchEpisode,
  onManageSubtitles,
  onSeekTo,
  onPausePlayback,
}: PlayerAuxiliaryDrawerProps) {
  const [learningProject, setLearningProject] = useState<string | null>(null);
  if (activeTab === "learn" && learningProject !== projectId) setLearningProject(projectId);
  const transcriptVersionKey = `${originalVersion?.id ?? "none"}:${originalVersion?.versionNumber ?? 0}:${translatedVersion?.id ?? "none"}:${translatedVersion?.versionNumber ?? 0}`;

  return (
    <PlayerDrawer
      activeTab={activeTab ?? "learn"}
      hidden={activeTab === null}
      mediaTitle={mediaTitle}
      contextLabel={contextLabel}
      contextStatus={contextStatus}
      episodeSummary={episodeSummary}
      onSelectTab={onSelectTab}
      onClose={onClose}
    >
      {learningProject === projectId ? (
        <LearningPanel
          embedded
          visible={activeTab === "learn"}
          key={projectId}
          projectId={projectId}
          playbackPositionMs={positionMs}
          sourceVersion={originalVersion}
          translationVersion={translatedVersion}
          sourceSegment={activeOriginal}
          translationSegment={activeTranslation}
          onPrepareSubtitles={onManageSubtitles}
          onClose={onClose}
          onJump={onSeekTo}
          onPausePlayback={onPausePlayback}
        />
      ) : null}
      {activeTab === "episodes" ? (
        <EpisodeDrawer
          projectId={projectId}
          mediaTitle={mediaTitle}
          pagination={episodePagination}
          detail={episodeNavigation.detail}
          episodes={episodeNavigation.episodes}
          currentEpisode={episodeNavigation.currentEpisode}
          neighbors={episodeNavigation.neighbors}
          loading={episodeNavigation.loading}
          error={episodeNavigation.error}
          switching={switchingEpisode}
          playbackPositionMs={positionMs}
          playbackDurationMs={durationMs}
          onSwitch={onSwitchEpisode}
        />
      ) : activeTab === "understand" ? (
        <UnderstandingPanel
          embedded
          key={projectId}
          projectId={projectId}
          playbackCutoffMs={positionMs}
          durationMs={durationMs}
          sourceVersion={originalVersion}
          translationVersion={translatedVersion}
          onPrepareSubtitles={onManageSubtitles}
          onClose={onClose}
          onJump={onSeekTo}
          onPausePlayback={onPausePlayback}
        />
      ) : activeTab === "transcript" ? (
        <SubtitleTranscriptPanel
          key={transcriptVersionKey}
          originalVersion={originalVersion}
          translatedVersion={translatedVersion}
          positionMs={positionMs}
          onPause={onPausePlayback}
          onSeekTo={onSeekTo}
        />
      ) : null}
    </PlayerDrawer>
  );
}
