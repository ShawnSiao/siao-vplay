import { useEffect, useRef, useState } from "react";
import type { Explanation } from "../../types";
import { readExplanationEvidence, type ExplanationEvidence } from "./explanationEvidence";

export function useExplanationEvidence(explanation: Explanation | null) {
  const current = useRef(explanation);
  useEffect(() => { current.current = explanation; }, [explanation]);
  const id = explanation?.id;
  const [result, setResult] = useState<{ id: string; data: ExplanationEvidence | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const value = current.current;
    if (!value || ![...value.confirmedFacts, ...value.possibleInterpretations].some((entry) => entry.subtitleSegmentIds.length || entry.frameIds.length)) return;
    let active = true;
    void readExplanationEvidence(value).then((data) => {
      if (active) setResult({ id: value.id, data });
    }).catch(() => { if (active) setResult({ id: value.id, data: null }); });
    return () => { active = false; };
  }, [id, attempt]);
  return {
    data: result?.id === id ? result?.data ?? null : null,
    failed: Boolean(result && result.id === id && !result.data),
    retry: () => { setResult(null); setAttempt((value) => value + 1); },
  };
}
