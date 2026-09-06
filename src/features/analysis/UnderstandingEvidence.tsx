import { formatDuration } from "../../lib/format";
import type { ExplanationEntry } from "../../types";
import type { ExplanationEvidence } from "./explanationEvidence";
import "./understanding-evidence.css";

export function UnderstandingEvidence({ entry, evidence, onJump }: {
  entry: ExplanationEntry; evidence?: ExplanationEvidence | null; onJump?: (time: number) => void;
}) {
  if (!entry.subtitleSegmentIds.length && !entry.frameIds.length) return <small className="understanding-evidence legacy">旧版结果未保存依据引用</small>;
  if (!evidence) return <small className="understanding-evidence">依据原任务的字幕与画面，时间引用尚未载入。</small>;
  const timestamp = (time: number, kind: string) => onJump
    ? <button type="button" aria-label={`定位${kind} ${formatDuration(time)}`} onClick={() => onJump(time)}>{formatDuration(time)}</button>
    : <span>{formatDuration(time)}</span>;
  return <div className="understanding-evidence readable">
    {entry.subtitleSegmentIds.map((id) => {
      const line = evidence.subtitles.find((item) => item.segmentId === id);
      return line ? <div key={id}>原文 {timestamp(line.startMs, "原文")}<blockquote>{line.text}</blockquote></div> : null;
    })}
    {entry.frameIds.map((id) => {
      const frame = evidence.frames.find((item) => item.id === id);
      return frame ? <div key={id}>画面 {timestamp(frame.timestampMs, "画面")}</div> : null;
    })}
  </div>;
}
