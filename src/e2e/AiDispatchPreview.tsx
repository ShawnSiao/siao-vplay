import { CurrentScenePanel } from "../components/CurrentScenePanel";
import { LearningPanel } from "../components/LearningPanel";
import type { SubtitleVersion } from "../types";
import { useState } from "react";

export function AiDispatchPreview({ kind, sourceVersion }: { kind: string; sourceVersion: SubtitleVersion }) {
  const [seek, setSeek] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const common = { projectId: sourceVersion.projectId, sourceVersion, translationVersion: null,
    onPrepareSubtitles: () => undefined, onClose: () => undefined, embedded: true };
  return <main className="understanding-preview"><section className="understanding-shell embedded">
    {kind === "learning" ? <LearningPanel {...common} playbackPositionMs={15_000} onJump={() => undefined}
      sourceSegment={sourceVersion.segments[0]} translationSegment={null} onPausePlayback={() => undefined} />
      : <CurrentScenePanel {...common} playbackCutoffMs={15_000} onJump={setSeek} onPausePlayback={() => setPaused(true)} />}
    {seek !== null ? <output aria-label="定位结果">{paused ? "已暂停" : "播放中"} · {seek} 毫秒</output> : null}
  </section></main>;
}
