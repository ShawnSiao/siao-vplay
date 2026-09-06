import { CurrentScenePanel } from "../components/CurrentScenePanel";
import { LearningPanel } from "../components/LearningPanel";
import type { SubtitleVersion } from "../types";

export function AiDispatchPreview({ kind, sourceVersion }: { kind: string; sourceVersion: SubtitleVersion }) {
  const common = { projectId: sourceVersion.projectId, sourceVersion, translationVersion: null,
    onPrepareSubtitles: () => undefined, onClose: () => undefined, embedded: true };
  return <main className="understanding-preview"><section className="understanding-shell embedded">
    {kind === "learning" ? <LearningPanel {...common} playbackPositionMs={15_000} onJump={() => undefined}
      sourceSegment={sourceVersion.segments[0]} translationSegment={null} onPausePlayback={() => undefined} />
      : <CurrentScenePanel {...common} playbackCutoffMs={15_000} />}
  </section></main>;
}
