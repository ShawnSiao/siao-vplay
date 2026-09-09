import { useCallback, useEffect, useRef, useState } from "react";
import { commandError } from "../../lib/desktop";

// Read completions own only their channel; explicit actions invalidate older reads.
export function useResourceFeedback() {
  const [error, updateError] = useState<string | null>(null);
  const state = useRef({ alive: true, epoch: 0, sequence: 0, operation: null as string | null,
    channels: new Map<string, { sequence: number; error: string | null }>() });
  useEffect(() => {
    const current = state.current;
    current.alive = true;
    return () => { current.alive = false; current.epoch++; };
  }, []);
  const setError = useCallback((message: string | null) => {
    const current = state.current;
    current.epoch++; current.operation = message; current.channels.clear();
    if (current.alive) updateError(message);
  }, []);
  const captureError = useCallback((cause: unknown) => {
    const message = commandError(cause).message; setError(message); return message;
  }, [setError]);
  const beginRead = useCallback((channel: string) => {
    const current = state.current;
    const epoch = current.epoch; const sequence = ++current.sequence;
    current.channels.set(channel, { sequence, error: current.channels.get(channel)?.error ?? null });
    return (cause?: unknown) => {
      if (!current.alive || epoch !== current.epoch || current.channels.get(channel)?.sequence !== sequence) return;
      current.channels.set(channel, { sequence, error: cause === undefined ? null : commandError(cause).message });
      const reads = [...current.channels.values()].sort((a, b) => b.sequence - a.sequence);
      updateError(current.operation ?? reads.find(read => read.error !== null)?.error ?? null);
    };
  }, []);
  return { error, setError, captureError, beginRead };
}
