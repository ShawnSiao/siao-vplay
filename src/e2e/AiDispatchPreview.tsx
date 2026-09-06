import { CurrentScenePanel } from "../components/CurrentScenePanel";
import { LearningPanel } from "../components/LearningPanel";
import type { SubtitleVersion } from "../types";
import { useState } from "react";

export function AiDispatchPreview({ kind, sourceVersion }: { kind: string; sourceVersion: SubtitleVersion }) {
  const [seek, setSeek] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [later, setLater] = useState(false);
  const contextFixture = new URLSearchParams(window.location.search).has("learning-context");
  const selectedSegment = later ? { ...sourceVersion.segments[0], id: "later-fixture", text: "Another example sentence." } : sourceVersion.segments[0];
  const common = { projectId: sourceVersion.projectId, sourceVersion, translationVersion: null,
    onPrepareSubtitles: () => undefined, onClose: () => undefined, embedded: true };
  return <main className="understanding-preview"><section className="understanding-shell embedded">
    {contextFixture ? <button type="button" onClick={() => setLater(true)}>测试：播放下一句</button> : null}
    {kind === "learning" ? <LearningPanel {...common} playbackPositionMs={later ? 25_000 : 15_000} onJump={() => undefined}
      sourceSegment={selectedSegment} translationSegment={null} onPausePlayback={() => undefined} />
      : <CurrentScenePanel {...common} playbackCutoffMs={15_000} onJump={setSeek} onPausePlayback={() => setPaused(true)} />}
    {seek !== null ? <output aria-label="定位结果">{paused ? "已暂停" : "播放中"} · {seek} 毫秒</output> : null}
  </section></main>;
}
