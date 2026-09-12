import { useMemo, useState } from "react";
import { importedDetail, mediaSummary } from "../features/library/libraryControllerTestFixtures";
export function useLibraryPagesPreview() {
  const mode = new URLSearchParams(location.search).get("collection-pages");
  const windowed = new URLSearchParams(location.search).has("bounded-pages");
  const [offset, setOffset] = useState(0);
  const total = mode === "1000" || mode === "10000" ? Number(mode) : 2;
  const [count, setCount] = useState(mode === "failed" ? 0 : total > 2 ? total : 1);
  const episodes = useMemo(() => total > 2 ? Array.from({ length: windowed ? Math.min(24, total - offset) : total }, (_, index) => mediaSummary(`episode-${(windowed ? offset : 0) + index + 1}`))
    : [mediaSummary("第一页"), mediaSummary("第二页")], [total, windowed, offset]);
  const [error, setError] = useState<string | null>(mode === "failed" ? "剧集读取失败，请重试" : null);
  const [attempt, setAttempt] = useState(0);
  return mode ? {
    currentCollection: { ...importedDetail, summary: { ...importedDetail.summary, itemCount: total } },
    currentEpisodes: windowed ? episodes : episodes.slice(0, count),
    collectionPagination: windowed ? {
      offset, totalCount: total, nextOffset: offset + 24 < total ? offset + 24 : null, error, loadingMore: false,
      loadMore: async () => { if (attempt === 0) { setError("后续剧集读取失败，请重试"); setAttempt(1); return false; }
        setOffset(offset + 24); setError(null); return true; },
      loadPrevious: async () => { setOffset(Math.max(0, offset - 24)); setError(null); return true; },
      reload: () => { setOffset(0); setError(null); },
    } : {
      totalCount: total, nextOffset: count === 1 ? 1 : null, error, loadingMore: false,
      loadMore: async () => { if (attempt === 0) { setError("后续剧集读取失败，请重试"); setAttempt(1); return false; }
        else { setCount(2); setError(null); return true; } },
      reload: () => { setCount(1); setError(null); setAttempt(0); },
    },
  } : { currentCollection: null, currentEpisodes: [] };
}
