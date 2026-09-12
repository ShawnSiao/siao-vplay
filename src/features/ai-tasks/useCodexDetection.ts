import { useCallback, useEffect, useState } from "react";
import type { CodexRuntimeStatus } from "../../types";

type Detection = { runtime: CodexRuntimeStatus | null; loading: boolean; failed: boolean };

// An optional executor check must never own a panel's task, history or draft loading.
export function useCodexDetection(read: () => Promise<CodexRuntimeStatus>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Detection>({ runtime: null, loading: true, failed: false });
  const retry = useCallback(() => {
    setState(current => ({ ...current, runtime: null, loading: true }));
    setAttempt(current => current + 1);
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => active ? read() : undefined).then(runtime => {
      if (active && runtime) setState({ runtime, loading: false, failed: false });
    }).catch(() => {
      if (active) setState({ runtime: null, loading: false, failed: true });
    });
    return () => { active = false; };
  }, [read, attempt]);
  return { ...state, retry };
}
