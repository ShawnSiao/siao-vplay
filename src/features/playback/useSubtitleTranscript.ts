import { useCallback, useEffect, useMemo, useState } from "react";

import type { SubtitleVersion } from "../../types";
import {
  buildTranscriptCues,
  findCurrentTranscriptCueIndex,
  searchTranscriptCues,
  transcriptCuesNearCurrent,
} from "./subtitleTranscriptModel";

export type TranscriptScope = "nearby" | "all";

type SubtitleTranscriptOptions = {
  originalVersion: SubtitleVersion | null;
  translatedVersion: SubtitleVersion | null;
  positionMs: number;
};

export function useSubtitleTranscript({
  originalVersion,
  translatedVersion,
  positionMs,
}: SubtitleTranscriptOptions) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [scope, setScope] = useState<TranscriptScope>("nearby");
  const [following, setFollowing] = useState(true);
  const cues = useMemo(
    () => buildTranscriptCues(originalVersion, translatedVersion),
    [originalVersion, translatedVersion],
  );
  const currentIndex = useMemo(
    () => findCurrentTranscriptCueIndex(cues, positionMs),
    [cues, positionMs],
  );
  const currentCueKey = currentIndex >= 0 ? cues[currentIndex]?.key ?? null : null;
  const scopedCues = useMemo(
    () =>
      scope === "nearby"
        ? transcriptCuesNearCurrent(cues, currentIndex)
        : cues,
    [cues, currentIndex, scope],
  );
  const visibleCues = useMemo(
    () => searchTranscriptCues(scopedCues, debouncedQuery),
    [debouncedQuery, scopedCues],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const pauseFollowing = useCallback(() => setFollowing(false), []);
  const resumeFollowing = useCallback(() => setFollowing(true), []);

  return {
    cues,
    visibleCues,
    currentIndex,
    currentCueKey,
    query,
    scope,
    following,
    setQuery,
    setScope,
    pauseFollowing,
    resumeFollowing,
  };
}
