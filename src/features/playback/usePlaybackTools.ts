import { useMemo, useState } from "react";

type ToolState = {
  subtitleDialogOpen: boolean;
  translationDialogOpen: boolean;
  translationSegmentIds: string[] | undefined;
  revisionDialogOpen: boolean;
  deliveryDialogOpen: boolean;
};
const closed: ToolState = {
  subtitleDialogOpen: false, translationDialogOpen: false, translationSegmentIds: undefined,
  revisionDialogOpen: false, deliveryDialogOpen: false,
};

// App assigns monotonically increasing IDs to every opening and return to library.
// Display state and callbacks belong to that session, including delayed resource callbacks.
export function usePlaybackTools(sessionId: number) {
  const [snapshot, setSnapshot] = useState({ sessionId, tools: closed });
  const setters = useMemo(() => {
    const update = (patch: Partial<ToolState>) => setSnapshot(current => {
      if (current.sessionId > sessionId) return current;
      const tools = current.sessionId === sessionId ? current.tools : closed;
      return { sessionId, tools: { ...tools, ...patch } };
    });
    return {
      setSubtitleDialogOpen: (open: boolean) => update({ subtitleDialogOpen: open }),
      setTranslationDialogOpen: (open: boolean) => update({ translationDialogOpen: open }),
      setTranslationSegmentIds: (ids: string[] | undefined) => update({ translationSegmentIds: ids?.slice() }),
      setRevisionDialogOpen: (open: boolean) => update({ revisionDialogOpen: open }),
      setDeliveryDialogOpen: (open: boolean) => update({ deliveryDialogOpen: open }),
    };
  }, [sessionId]);
  return { ...(snapshot.sessionId === sessionId ? snapshot.tools : closed), ...setters };
}
