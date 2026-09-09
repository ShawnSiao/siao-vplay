import type { LibraryCollectionPagination } from "../useLibraryCollectionPaging";
export function MediaPageFooter({ page, count, offset = 0, contentKind = "episodes", onPrevious, onNext }: { page: LibraryCollectionPagination; count: number; offset?: number; contentKind?: "episodes" | "videos"; onPrevious?: () => void; onNext?: () => void }) {
  return <div className="library-episode-load-more">
    {page.error ? <span role="alert">{page.error}</span> : <span role="status">已显示 {offset ? `${offset + 1}–${offset + count}` : count} / {page.totalCount} {contentKind === "videos" ? "个视频" : "集"}</span>}
    {onPrevious ? <button className="library-back-button" type="button" disabled={page.offset !== undefined && page.loadingMore} onClick={onPrevious}>上一页{contentKind === "videos" ? "视频" : "剧集"}</button> : null}
    {onNext ? <button className="library-back-button" type="button" onClick={onNext}>下一页{contentKind === "videos" ? "视频" : "剧集"}</button> : null}
    {page.nextOffset !== null ? <button className={contentKind === "videos" ? "library-back-button" : "library-heading-primary"} type="button" disabled={page.loadingMore}
      onClick={() => { void page.loadMore(); }}>{page.loadingMore ? "正在读取…" : page.offset !== undefined ? "下一页剧集" : page.error ? (contentKind === "videos" ? "重试加载" : "重试加载更多") : (contentKind === "videos" ? "加载更多视频" : "加载更多剧集")}</button> : null}
    {page.error ? <button className="library-back-button" type="button" disabled={page.loadingMore} onClick={page.reload}>{contentKind === "videos" ? "重新加载列表" : "重新加载剧集"}</button> : null}
  </div>;
}
