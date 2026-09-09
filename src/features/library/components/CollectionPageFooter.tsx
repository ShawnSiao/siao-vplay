import type { LibraryCollectionPagination } from "../useLibraryCollectionPaging";
export function CollectionPageFooter({ page, count }: { page: LibraryCollectionPagination; count: number }) {
  return <div className="library-episode-load-more">
    {page.error ? <span role="alert">{page.error}</span> : <span role="status">已显示 {count} / {page.totalCount} 集</span>}
    {page.nextOffset !== null ? <button className="library-heading-primary" type="button" disabled={page.loadingMore}
      onClick={() => { void page.loadMore(); }}>{page.loadingMore ? "正在读取…" : page.error ? "重试加载更多" : "加载更多剧集"}</button> : null}
    {page.error ? <button className="library-back-button" type="button" disabled={page.loadingMore} onClick={page.reload}>重新加载剧集</button> : null}
  </div>;
}
