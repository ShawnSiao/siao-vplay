import { useEffect, useLayoutEffect, useRef } from "react";
import type { ExternalAgentResultUpdate } from "../../types";

type Options = {
  enabled: boolean;
  reconcile: () => Promise<ExternalAgentResultUpdate[]>;
  acknowledge: (updates: ExternalAgentResultUpdate[]) => Promise<void>;
  /** May be replayed after failure or an interrupted lifetime; consumers must be idempotent. */
  onUpdates: (updates: ExternalAgentResultUpdate[], isActive: () => boolean) => Promise<void> | void;
};

/** Reconciliation consumes results: changing the viewed video must not discard an in-flight batch. */
export function useExternalAgentResults({ enabled, reconcile, acknowledge, onUpdates }: Options) {
  const scanning = useRef(false);
  const pending = useRef<ExternalAgentResultUpdate[] | null>(null);
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
        const updates = pending.current ?? await reconcile();
        pending.current = updates.length ? updates : null;
        if (live.current && updates.length) {
          const identity = lifetime.current;
          const isActive = () => live.current && lifetime.current === identity;
          await handler.current(updates, isActive);
          if (isActive()) await acknowledge(updates);
          if (isActive()) pending.current = null;
        }
      } catch {
        // Keep at most one consumed batch until the active consumer succeeds.
        // Completed results also remain durable until acknowledgement succeeds.
      } finally { scanning.current = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => { live.current = false; lifetime.current += 1; window.clearInterval(timer); };
  }, [enabled, reconcile, acknowledge]);
}
