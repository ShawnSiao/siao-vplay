import { useCallback, useRef, useState } from "react";
import type { LocalResourceStatus } from "../../types";
export function useResourceStatusState() {
  const [status, updateStatus] = useState<LocalResourceStatus | null>(null);
  const latest = useRef<LocalResourceStatus | null>(null);
  // Return the accepted snapshot so dependent actions cannot consume an older read.
  const setStatus = useCallback((next: LocalResourceStatus): LocalResourceStatus => {
    if (!latest.current || next.snapshotRevision > latest.current.snapshotRevision) {
      latest.current = next;
      updateStatus(next);
    }
    return latest.current;
  }, []);
  return { status, setStatus };
}
