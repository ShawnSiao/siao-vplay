import type { CollectionSummary, LibraryMediaSummary } from "../../../types";
import type { LibrarySectionPageState } from "../useLibraryController";
import { LibraryMediaItem } from "./LibraryMediaItem";

type LibraryMediaListViewProps = {
  kind: "watch_later" | "unclassified";
  page: LibrarySectionPageState;
  collections: CollectionSummary[];
  mutationPending: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpen: (media: LibraryMediaSummary) => void;
  onRelink: (media: LibraryMediaSummary) => void;
  onDelete: (media: LibraryMediaSummary) => void;
  onOpenLocation: (media: LibraryMediaSummary) => void;
  onAddToCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onRemoveFromCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onSetWatchLater: (projectId: string, enabled: boolean) => Promise<unknown>;
};

export function LibraryMediaListView({
  kind,
  page,
  onRetry,
  onLoadMore,
  ...mediaProps
}: LibraryMediaListViewProps) {
  const watchLater = kind === "watch_later";
  const title = watchLater ? "稍后观看" : "未分类";
  const emptyTitle = watchLater
    ? "还没有稍后观看的视频"
    : "所有视频都已分类";
  const emptyDescription = watchLater
    ? "可从未分类列表或播放器将视频加入稍后观看。"
    : "新导入且未加入合集的视频会显示在这里。";

  return (
    <div className="library-page library-media-list-page">
      <header className="library-page-heading">
        <div>
          <p className="library-eyebrow">媒体库</p>
          <h1>{title}</h1>
          <p>
            共 {page.totalCount} 个视频
            {page.initialized ? `，已加载 ${page.items.length} 个` : ""}。
          </p>
        </div>
      </header>

      {page.loading && !page.initialized ? (
        <div className="library-loading" aria-live="polite">
          <span className="spinner" />正在读取{title}…
        </div>
      ) : page.error && page.items.length === 0 ? (
        <div className="library-empty-panel library-error-panel" role="alert">
          <strong>列表暂时无法读取</strong>
          <p>{page.error}</p>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      ) : page.items.length ? (
        <>
          <div className="library-media-list">
            {page.items.map((media) => (
              <LibraryMediaItem
                key={media.projectId}
                media={media}
                context={{ kind }}
                {...mediaProps}
              />
            ))}
          </div>
          <footer className="library-list-footer">
            <span>已加载 {page.items.length} / {page.totalCount}</span>
            {page.error ? (
              <span className="library-inline-error" role="alert">
                {page.error}
                <button type="button" onClick={onLoadMore}>重试加载</button>
              </span>
            ) : page.nextOffset !== null ? (
              <button type="button" disabled={page.loadingMore} onClick={onLoadMore}>
                {page.loadingMore ? "正在加载…" : "加载更多"}
              </button>
            ) : (
              <span>已显示全部</span>
            )}
          </footer>
        </>
      ) : (
        <div className="library-empty-panel">
          <strong>{emptyTitle}</strong>
          <p>{emptyDescription}</p>
        </div>
      )}
    </div>
  );
}
