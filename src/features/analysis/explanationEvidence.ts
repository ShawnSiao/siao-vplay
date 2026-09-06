import { invoke } from "@tauri-apps/api/core";
import type { Explanation } from "../../types";

export type ExplanationEvidence = {
  explanationId: string; projectId: string; taskId: string; sourceVersionId: string; playbackCutoffMs: number;
  subtitles: Array<{ segmentId: string; startMs: number; endMs: number; text: string }>;
  frames: Array<{ id: string; timestampMs: number }>;
};

export async function readExplanationEvidence(explanation: Explanation): Promise<ExplanationEvidence> {
  const data = await invoke<ExplanationEvidence>("get_explanation_evidence", { explanationId: explanation.id });
  const entries = [...explanation.confirmedFacts, ...explanation.possibleInterpretations];
  const ids = new Set(entries.flatMap((item) => item.subtitleSegmentIds));
  const frames = new Set(entries.flatMap((item) => item.frameIds));
  const time = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= explanation.playbackCutoffMs;
  if (!data || data.explanationId !== explanation.id || data.taskId !== explanation.taskId ||
      data.projectId !== explanation.projectId || data.sourceVersionId !== explanation.sourceVersionId ||
      data.playbackCutoffMs !== explanation.playbackCutoffMs ||
      !Array.isArray(data.subtitles) || data.subtitles.length > 40 ||
      !Array.isArray(data.frames) || data.frames.length > 6 ||
      data.subtitles.some((item) => !item || !ids.has(item.segmentId) || !time(item.startMs) ||
        !Number.isSafeInteger(item.endMs) || item.endMs < item.startMs || typeof item.text !== "string" || item.text.length > 20_000) ||
      data.frames.some((item) => !item || !frames.has(item.id) || !time(item.timestampMs)) ||
      new Set(data.subtitles.map((item) => item.segmentId)).size !== data.subtitles.length ||
      new Set(data.frames.map((item) => item.id)).size !== data.frames.length ||
      data.subtitles.length !== ids.size || data.frames.length !== frames.size) {
    throw new Error("证据与当前理解结果不一致");
  }
  return data;
}
