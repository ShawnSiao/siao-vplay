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
        let fresh: ExternalAgentResultUpdate[] = [];
        try { fresh = await reconcile(); } catch {
          // A failed scan must not discard previously consumed transient notices.
        }
        const merged = new Map<string, ExternalAgentResultUpdate>();
        for (const update of [...(pending.current ?? []), ...fresh]) {
          merged.set(JSON.stringify([update.taskKind, update.taskId]), update);
        }
        const updates = [...merged.values()];
        pending.current = updates.length ? updates : null;
        if (live.current && updates.length) {
          const identity = lifetime.current;
          const isActive = () => live.current && lifetime.current === identity;
          for (const update of updates) {
            if (!isActive()) break;
            try {
              await handler.current([update], isActive);
              if (isActive()) await acknowledge([update]);
              if (isActive()) {
                const remaining = pending.current?.filter(candidate => candidate !== update) ?? [];
                pending.current = remaining.length ? remaining : null;
              }
            } catch {
              // Completed results replay from the durable queue; do not accumulate failed pages.
              if (isActive() && update.status === "completed") {
                const remaining = pending.current?.filter(candidate => candidate !== update) ?? [];
                pending.current = remaining.length ? remaining : null;
              }
            }
          }
        }
      } catch {
        // Unprocessed notices remain pending; completed results remain durable until acknowledged.
      } finally { scanning.current = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => { live.current = false; lifetime.current += 1; window.clearInterval(timer); };
  }, [enabled, reconcile, acknowledge]);
}
