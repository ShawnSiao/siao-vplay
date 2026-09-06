import { useState } from "react";
import type { SubtitleSegment, SubtitleVersion } from "../../types";

export type LearningContext = {
  projectId: string;
  playbackPositionMs: number;
  sourceVersion: SubtitleVersion | null;
  translationVersion: SubtitleVersion | null;
  sourceSegment: SubtitleSegment | null;
  translationSegment: SubtitleSegment | null;
};

export function useLearningContext(incoming: LearningContext) {
  const [context, setContext] = useState(incoming);
  const changed = context.sourceVersion?.id !== incoming.sourceVersion?.id ||
    context.translationVersion?.id !== incoming.translationVersion?.id ||
    context.sourceSegment?.id !== incoming.sourceSegment?.id ||
    context.translationSegment?.id !== incoming.translationSegment?.id;
  return { context, changed, selectCurrent: () => setContext(incoming) };
}
