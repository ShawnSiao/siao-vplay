import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LibraryMediaSummary } from "../../types";
import { libraryViewPolicy } from "../library/libraryViewPolicy";
export function useEpisodeListWindow(scope: string, episodes: LibraryMediaSummary[], projectId: string) {
  const size = libraryViewPolicy.episodeRenderPageSize;
  const currentIndex = episodes.findIndex(episode => episode.projectId === projectId);
  const [selection, setSelection] = useState<{ scope: string; start: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusScope = useRef<string | null>(null);
  const intent = useRef(0), busy = useRef<number | null>(null);
  const requested = selection?.scope === scope ? selection.start : Math.floor(Math.max(0, currentIndex) / size) * size;
  const start = Math.min(requested, Math.max(0, Math.floor((episodes.length - 1) / size) * size));
  useEffect(() => () => { intent.current += 1; busy.current = null; }, [scope]);
  useLayoutEffect(() => {
    if (focusScope.current === scope) {
      const target = listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? listRef.current;
      if (listRef.current) listRef.current.scrollTop = 0;
      target?.focus();
    }
    focusScope.current = null;
  });
  const show = (offset: number) => { intent.current += 1; focusScope.current = scope; setSelection({ scope, start: offset }); };
  const loadMore = async (read: () => Promise<boolean>) => {
    if (busy.current !== null) return;
    const current = ++intent.current;
    busy.current = current;
    try { if (await read() && current === intent.current) show(Math.floor(episodes.length / size) * size); }
    finally { if (busy.current === current) busy.current = null; }
  };
  return { listRef, start, items: episodes.slice(start, start + size),
    previous: start > 0 ? () => show(start - size) : undefined,
    next: start + size < episodes.length ? () => show(start + size) : undefined, loadMore };
}
