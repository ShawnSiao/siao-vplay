import type { HistoryPagination } from "./useSubtitleHistoryPages";
import "./subtitle-history.css";
import { useLayoutEffect, useRef } from "react";

export function SubtitleHistoryPager({ page }: { page?: HistoryPagination }) {
  const root = useRef<HTMLDivElement>(null);
  const previousOffset = useRef(page?.offset);
  useLayoutEffect(() => {
    if (previousOffset.current !== page?.offset && document.activeElement === document.body) root.current?.focus();
    previousOffset.current = page?.offset;
  }, [page?.offset]);
  if (!page) return null;
  return <div ref={root} tabIndex={-1} role="group" className="subtitle-history-pager" aria-label="字幕历史分页">
    <span role="status">版本列表 {page.count ? `${page.offset + 1}–${page.offset + page.count}` : "0"} / {page.totalCount}</span>
    {page.error ? <p role="alert">{page.error}</p> : null}
    <div>
      {page.previous ? <button className="button quiet" type="button" disabled={page.loading} onClick={page.previous}>上一页版本</button> : null}
      {page.next ? <button className="button quiet" type="button" disabled={page.loading} onClick={page.next}>{page.loading ? "正在读取…" : "下一页版本"}</button> : null}
      <button className="button quiet" type="button" disabled={page.loading} onClick={page.reload}>重新读取历史</button>
    </div>
  </div>;
}
