import { useState } from "react";
import type { LibrarySection, LibrarySectionPages } from "../features/library/librarySectionState";
import type { LibraryMediaSummary } from "../types";

export function useSectionWindowPreview(example: LibraryMediaSummary) {
  const raw = new URLSearchParams(location.search).get("section-window");
  const total = raw === "26" || raw === "1000" || raw === "10000" ? Number(raw) : 0;
  const [offset, setOffset] = useState(0);
  const [failed, setFailed] = useState<number | null>(null);
  const [attempted, setAttempted] = useState(false);
  const read = async (next: number) => {
    if (!attempted) { setAttempted(true); setFailed(next); return false; }
    setOffset(next); setFailed(null); return true;
  };
  if (!total) return null;
  const requested = new URLSearchParams(location.search).get("section");
  const initialSection: LibrarySection = requested === "home" || requested === "watch_later" ? requested : "unclassified";
  const items = Array.from({ length: Math.min(24, total - offset) }, (_, i) => ({ ...example,
    projectId: `window-${offset + i + 1}`, projectTitle: `分页视频 ${offset + i + 1}`, displayName: `video-${offset + i + 1}.mp4`,
  }));
  const page = { items, offset, pageSize: 24, totalCount: total, nextOffset: offset + 24 < total ? offset + 24 : null,
    initialized: true, loading: false, loadingMore: false, error: failed === null ? null : "读取暂时失败" };
  const pages: LibrarySectionPages = { unclassified: page, watch_later: page, continue_watching: page };
  return { pages, total, initialSection, loadMore: () => read(offset + 24), previous: () => read(Math.max(0, offset - 24)),
    retry: () => failed === null ? Promise.resolve(false) : read(failed), reload: () => { setOffset(0); setFailed(null); } };
}
