import { useEffect, useRef, useState } from "react";
import { commandError, listSubtitleVersions } from "../../lib/desktop";
import { readSubtitleMetadataPage } from "../../lib/subtitleMetadataPageGateway";
import type { SubtitleMetadataPage } from "../../generated/subtitle-metadata-page";
import type { SubtitleVersion } from "../../types";

export type HistoryPagination = { offset: number; count: number; totalCount: number; loading: boolean; error: string | null;
  previous?: () => void; next?: () => void; reload: () => void };
type Catalog = { currentVersions: SubtitleVersion[]; page: SubtitleMetadataPage };
const PAGE_SIZE = 24;

export function useSubtitleHistoryPages(projectId: string) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    const request = ++sequence.current;
    void Promise.all([listSubtitleVersions(projectId, false), readSubtitleMetadataPage(projectId, 0)]).then(([versions, page]) => {
      const currentVersions = versions.filter(version => version.isCurrent);
      if (page.currentVersions.length !== currentVersions.length || currentVersions.some(version => !page.currentVersions.some(
        item => item.id === version.id && item.segmentCount === version.segments.length))) throw new Error("字幕版本已变化，请重新读取");
      if (request === sequence.current) setCatalog({ currentVersions, page });
    }).catch((cause: unknown) => { if (request === sequence.current) setError(commandError(cause).message); });
    return () => { sequence.current += 1; pending.current = false; };
  }, [projectId, attempt]);
  const readPage = async (offset: number, reload = false) => {
    if (!catalog || pending.current) return;
    pending.current = true;
    setLoading(true); setPageError(null);
    const request = ++sequence.current;
    try {
      const page = await readSubtitleMetadataPage(projectId, offset, reload ? undefined : catalog.page.snapshotToken);
      if (!reload && page.totalCount !== catalog.page.totalCount) throw new Error("字幕历史已变化，请重新读取");
      if (request === sequence.current) setCatalog(current => current ? { ...current, page } : current);
    } catch (cause: unknown) {
      if (request === sequence.current) setPageError(commandError(cause).message);
    } finally {
      if (request === sequence.current) { pending.current = false; setLoading(false); }
    }
  };
  const page = catalog?.page;
  const pagination: HistoryPagination | undefined = page ? {
    offset: page.offset, count: page.items.length, totalCount: page.totalCount, loading, error: pageError,
    previous: page.offset > 0 ? () => { void readPage(Math.max(0, page.offset - PAGE_SIZE)); } : undefined,
    next: page.nextOffset !== null ? () => { void readPage(page.nextOffset!); } : undefined,
    reload: () => { void readPage(0, true); },
  } : undefined;
  return { catalog, pagination, error, retry: () => { setError(null); setAttempt(value => value + 1); } };
}
