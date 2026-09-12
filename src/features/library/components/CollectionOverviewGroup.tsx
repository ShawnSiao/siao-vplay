import { playbackUrl } from "../../../lib/desktop";
import { formatDuration } from "../../../lib/format";
import type { CollectionSummary } from "../../../types";
import type { CollectionOverviewReader } from "../useCollectionOverviewPages";
import { useCollectionGroupPages } from "../useCollectionGroupPages";
import { useCollectionGroupFocus } from "../useCollectionGroupFocus";
import { OverviewPagination } from "./OverviewPagination";
import "./overview-pagination.css";

type Props = {
  title: string; description: string; rootLinked: boolean; refreshKey?: unknown;
  readCollections?: CollectionOverviewReader; onOpenCollection: (id: string) => void;
};
export function CollectionOverviewGroup(props: Props) {
  const pages = useCollectionGroupPages(props.rootLinked, props.refreshKey, props.readCollections);
  const { root, onFocusCapture } = useCollectionGroupFocus(pages.page, pages.loading);
  const items = pages.page?.items ?? [];
  return <section ref={root} tabIndex={-1} onFocusCapture={onFocusCapture} className="library-section" aria-labelledby={`${props.title}-title`}>
    <div className="library-section-heading"><div><h2 id={`${props.title}-title`}>{props.title}</h2><p>{props.description}</p></div>
      <span>{pages.page ? `${pages.page.totalCount} 个` : ""}</span></div>
    {items.length ? <div className="library-series-grid">{items.map(collection => <SeriesCard key={collection.id} collection={collection}
      disabled={pages.loading || Boolean(pages.error)} onOpen={() => props.onOpenCollection(collection.id)} />)}</div>
      : !pages.loading && !pages.error ? <div className="library-empty-panel compact">当前分组还没有内容。</div> : null}
    <OverviewPagination offset={pages.page?.offset ?? 0} count={items.length} totalCount={pages.page?.totalCount ?? null}
      hasNext={pages.page?.nextOffset != null} loading={pages.loading} error={pages.error}
      onNext={pages.next} onPrevious={pages.previous} onReload={pages.reload} onRetry={pages.retry} />
  </section>;
}

function SeriesCard({
  collection,
  onOpen,
  disabled,
}: {
  collection: CollectionSummary;
  onOpen: () => void;
  disabled: boolean;
}) {
  const progress = collection.itemCount
    ? Math.round((collection.watchedCount / collection.itemCount) * 100)
    : 0;
  return (
    <button
      className="library-series-tile"
      type="button"
      aria-label={`打开合集 ${collection.title}`}
      onClick={onOpen}
      disabled={disabled} data-collection-id={collection.id}
      data-has-poster={Boolean(collection.posterPath)}
    >
      <span className="library-series-tile-poster">
        {collection.posterPath ? (
          <img src={playbackUrl(collection.posterPath)} alt="" />
        ) : (
          <span aria-hidden="true">{collection.rootId ? "▦" : "▤"}</span>
        )}
        <i className="library-series-kind">
          {collection.rootId ? "文件夹剧集" : "自建合集"}
        </i>
      </span>
      <span className="library-series-tile-copy">
        <strong title={collection.title}>{collection.title}</strong>
        <small>
          {collection.itemCount} 集
          {collection.seasonCount ? ` · ${collection.seasonCount} 季` : ""}
          {collection.totalDurationMs
            ? ` · ${formatDuration(collection.totalDurationMs)}`
            : ""}
        </small>
        <span className="library-progress-track" aria-label={`观看进度 ${progress}%`}>
          <i style={{ width: `${progress}%` }} />
        </span>
        <small>{collection.watchedCount} 集已看</small>
      </span>
    </button>
  );
}
