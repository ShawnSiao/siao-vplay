import { useState } from "react";
import { importedDetail, mediaSummary } from "../features/library/libraryControllerTestFixtures";
export function useLibraryPagesPreview() {
  const mode = new URLSearchParams(location.search).get("collection-pages");
  const [count, setCount] = useState(mode === "failed" ? 0 : 1);
  const [error, setError] = useState<string | null>(mode === "failed" ? "剧集读取失败，请重试" : null);
  const [attempt, setAttempt] = useState(0);
  return mode ? {
    currentCollection: { ...importedDetail, summary: { ...importedDetail.summary, itemCount: 2 } },
    currentEpisodes: [mediaSummary("第一页"), mediaSummary("第二页")].slice(0, count),
    collectionPagination: {
      totalCount: 2, nextOffset: count === 1 ? 1 : null, error, loadingMore: false,
      loadMore: async () => { if (attempt === 0) { setError("后续剧集读取失败，请重试"); setAttempt(1); }
        else { setCount(2); setError(null); } },
      reload: () => { setCount(1); setError(null); setAttempt(0); },
    },
  } : { currentCollection: null, currentEpisodes: [] };
}
