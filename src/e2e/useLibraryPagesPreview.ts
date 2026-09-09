import { useMemo, useState } from "react";
import { importedDetail, mediaSummary } from "../features/library/libraryControllerTestFixtures";
export function useLibraryPagesPreview() {
  const mode = new URLSearchParams(location.search).get("collection-pages");
  const total = mode === "1000" || mode === "10000" ? Number(mode) : 2;
  const [count, setCount] = useState(mode === "failed" ? 0 : total > 2 ? total : 1);
  const episodes = useMemo(() => total > 2 ? Array.from({ length: total }, (_, index) => mediaSummary(`episode-${index + 1}`))
    : [mediaSummary("第一页"), mediaSummary("第二页")], [total]);
  const [error, setError] = useState<string | null>(mode === "failed" ? "剧集读取失败，请重试" : null);
  const [attempt, setAttempt] = useState(0);
  return mode ? {
    currentCollection: { ...importedDetail, summary: { ...importedDetail.summary, itemCount: total } },
    currentEpisodes: episodes.slice(0, count),
    collectionPagination: {
      totalCount: total, nextOffset: count === 1 ? 1 : null, error, loadingMore: false,
      loadMore: async () => { if (attempt === 0) { setError("后续剧集读取失败，请重试"); setAttempt(1); return false; }
        else { setCount(2); setError(null); return true; } },
      reload: () => { setCount(1); setError(null); setAttempt(0); },
    },
  } : { currentCollection: null, currentEpisodes: [] };
}
