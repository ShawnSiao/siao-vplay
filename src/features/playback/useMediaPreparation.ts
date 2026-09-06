import { useCallback, useEffect, useRef, useState } from "react";
import { cancelMediaPreparation, getMediaPreparation, prepareProjectMedia } from "../../lib/desktop";
import type { MediaPreparationProgress } from "../../lib/mediaPreparationGateway";

type Request = {
  id: string;
  settled: boolean;
  cancelRequested: boolean;
  finished: Promise<void>;
  finish: () => void;
};

export function useMediaPreparation() {
  const current = useRef<Request | null>(null);
  const [progress, setProgress] = useState<MediaPreparationProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reset = useCallback(() => {
    current.current = null;
    setProgress(null);
    setCancelling(false);
    setCanCancel(false);
  }, []);

  const start = useCallback(async (projectId: string, forceProxy: boolean) => {
    let finish = () => {};
    const request: Request = {
      id: crypto.randomUUID(), settled: false, cancelRequested: false,
      finished: new Promise<void>((resolve) => { finish = resolve; }),
      finish: () => finish(),
    };
    current.current = request;
    setProgress(null);
    setCancelling(false);
    setCanCancel(true);
    let polling = false;
    const poll = async () => {
      if (polling || request.settled) return;
      polling = true;
      try {
        const snapshot = await getMediaPreparation(request.id);
        if (mounted.current && current.current === request && snapshot) setProgress(snapshot);
      } catch { /* A failed status read never implies task completion. */ }
      finally { polling = false; }
    };
    const timer = window.setInterval(() => { void poll(); }, 500);
    try {
      const result = await prepareProjectMedia(projectId, forceProxy, request.id);
      if (request.cancelRequested) throw { code: "preparation_cancelled", message: "准备已停止，可以重新打开视频。" };
      return result;
    } finally {
      request.settled = true;
      request.finish();
      window.clearInterval(timer);
      if (mounted.current && current.current === request) {
        setCanCancel(false);
        setCancelling(false);
      }
    }
  }, []);

  const cancel = useCallback(async () => {
    const request = current.current;
    if (!request || request.settled || request.cancelRequested) return;
    request.cancelRequested = true;
    setCancelling(true);
    try {
      // Registration and cancellation are separate IPC calls. Retry a not-yet-registered request.
      while (!request.settled && !await cancelMediaPreparation(request.id)) {
        await Promise.race([request.finished, new Promise((resolve) => window.setTimeout(resolve, 100))]);
      }
      await request.finished;
    } catch (error) {
      request.cancelRequested = false;
      if (mounted.current && current.current === request) setCancelling(false);
      throw error;
    }
  }, []);
  return { start, reset, cancel, progress, cancelling, canCancel };
}
