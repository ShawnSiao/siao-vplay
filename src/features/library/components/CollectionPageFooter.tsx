import type { LibraryCollectionPagination } from "../useLibraryCollectionPaging";
export function CollectionPageFooter({ page, count, offset = 0, onPrevious, onNext }: { page: LibraryCollectionPagination; count: number; offset?: number; onPrevious?: () => void; onNext?: () => void }) {
  return <div className="library-episode-load-more">
    {page.error ? <span role="alert">{page.error}</span> : <span role="status">已显示 {offset ? `${offset + 1}–${offset + count}` : count} / {page.totalCount} 集</span>}
    {onPrevious ? <button className="library-back-button" type="button" onClick={onPrevious}>上一页剧集</button> : null}
    {onNext ? <button className="library-back-button" type="button" onClick={onNext}>下一页剧集</button> : null}
    {page.nextOffset !== null ? <button className="library-heading-primary" type="button" disabled={page.loadingMore}
      onClick={() => { void page.loadMore(); }}>{page.loadingMore ? "正在读取…" : page.error ? "重试加载更多" : "加载更多剧集"}</button> : null}
    {page.error ? <button className="library-back-button" type="button" disabled={page.loadingMore} onClick={page.reload}>重新加载剧集</button> : null}
  </div>;
}
