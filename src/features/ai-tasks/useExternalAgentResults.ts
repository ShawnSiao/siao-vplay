import { useEffect, useLayoutEffect, useRef } from "react";
import type { ExternalAgentResultUpdate } from "../../types";

type Options = {
  enabled: boolean;
  reconcile: () => Promise<ExternalAgentResultUpdate[]>;
  onUpdates: (updates: ExternalAgentResultUpdate[], isActive: () => boolean) => Promise<void> | void;
};

/** Reconciliation consumes results: changing the viewed video must not discard an in-flight batch. */
export function useExternalAgentResults({ enabled, reconcile, onUpdates }: Options) {
  const scanning = useRef(false);
  const live = useRef(false);
  const lifetime = useRef(0);
  const handler = useRef(onUpdates);
  useLayoutEffect(() => { handler.current = onUpdates; }, [onUpdates]);
  useEffect(() => {
    if (!enabled) return;
    live.current = true;
    const poll = async () => {
      if (scanning.current) return;
      scanning.current = true;
      try {
        const updates = await reconcile();
        if (live.current && updates.length) {
          const identity = lifetime.current;
          await handler.current(updates, () => live.current && lifetime.current === identity);
        }
      } catch {
        // Explicit result import remains available if background reconciliation fails.
      } finally { scanning.current = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => { live.current = false; lifetime.current += 1; window.clearInterval(timer); };
  }, [enabled, reconcile]);
}
