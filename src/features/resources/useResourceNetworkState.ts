import { useCallback, useRef, useState } from "react";
import type { ResourceNetworkStatus } from "../../types";

export function useResourceNetworkState() {
  const [networkStatus, update] = useState<ResourceNetworkStatus | null>(null);
  const latest = useRef<{ revision: number; value: ResourceNetworkStatus | null }>({ revision: 0, value: null });
  const setNetworkStatus = useCallback((next: ResourceNetworkStatus) => {
    if (next.snapshotRevision > latest.current.revision) {
      latest.current = { revision: next.snapshotRevision, value: next }; update(next);
    }
    return latest.current.value ?? next;
  }, []);
  const networkRevision = useCallback(() => latest.current.revision, []);
  const invalidateNetwork = useCallback((revision: number) => {
    if (latest.current.revision === revision) { latest.current.value = null; update(null); }
  }, []);
  return { networkStatus, setNetworkStatus, networkRevision, invalidateNetwork };
}
