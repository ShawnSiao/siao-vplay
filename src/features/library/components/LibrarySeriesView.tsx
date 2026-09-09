import type { LibraryCollectionPagination } from "../useLibraryCollectionPaging";
import { PagedMediaList } from "./PagedMediaList";
import type { CollectionOverviewReader } from "../useCollectionOverviewPages";
import { CollectionOverviewGroup } from "./CollectionOverviewGroup";

import { MenuPopover } from "../../../components/MenuPopover";
import { playbackUrl } from "../../../lib/desktop";
import { formatDuration } from "../../../lib/format";
import type {
  CollectionDetail,
  LibraryMediaSummary,
} from "../../../types";
import { LibraryMediaItem } from "./LibraryMediaItem";

type LibrarySeriesViewProps = {
  refreshKey?: unknown;
  readCollections?: CollectionOverviewReader;
  currentCollection: CollectionDetail | null;
  currentEpisodes: LibraryMediaSummary[];
  selectedSeason: number | null;
  collectionLoading: boolean;
  collectionPagination?: LibraryCollectionPagination;
  mutationPending: boolean;
  onOpenCollection: (collectionId: string) => void;
  onCloseCollection: () => void;
  onSelectSeason: (season: number | null) => void;
  onCreateCollection: () => void;
  onEditCollection: () => void;
  onDeleteCollection: () => void;
  onToggleAutoPlay: () => void;
  onOpen: (media: LibraryMediaSummary) => void;
  onRelink: (media: LibraryMediaSummary) => void;
  onDelete: (media: LibraryMediaSummary) => void;
  onOpenLocation: (media: LibraryMediaSummary) => void;
  onAddToCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onRemoveFromCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onSetWatchLater: (projectId: string, enabled: boolean) => Promise<unknown>;
  onSetWatched: (projectId: string, watched: boolean) => Promise<unknown>;
};

function CollectionDetailView(props: LibrarySeriesViewProps) {
  const { currentCollection } = props;
  if (!currentCollection) return null;
  const { summary } = currentCollection;
  const progress = summary.itemCount
    ? Math.round((summary.watchedCount / summary.itemCount) * 100)
    : 0;

  return (
    <div className="library-page library-collection-detail">
      <header className="library-page-heading library-collection-heading">
        <button className="library-back-button" type="button" onClick={props.onCloseCollection}>
          ‹ 返回剧集
        </button>
        <div className="library-collection-heading-actions">
          <button
            type="button"
            aria-pressed={summary.autoPlayNext}
            disabled={props.mutationPending}
            onClick={props.onToggleAutoPlay}
          >
            自动连播：{summary.autoPlayNext ? "开" : "关"}
          </button>
          {summary.systemKey === null ? (
            <MenuPopover className="library-page-menu" label="合集管理">
                <button type="button" role="menuitem" onClick={props.onEditCollection}>
                  重命名
                </button>
                <button
                  className="danger"
                  type="button"
                  role="menuitem"
                  onClick={props.onDeleteCollection}
                >
                  删除合集
                </button>
            </MenuPopover>
          ) : null}
        </div>
      </header>

      <div className="library-collection-layout">
        <aside className="library-collection-summary">
          <div className="library-collection-poster">
            {summary.posterPath ? (
              <img src={playbackUrl(summary.posterPath)} alt="" />
            ) : (
              <span aria-hidden="true">{summary.rootId ? "▦" : "▤"}</span>
            )}
          </div>
          <p className="library-eyebrow">{summary.rootId ? "文件夹剧集" : "自建合集"}</p>
          <h1>{summary.title}</h1>
          <dl>
            <div><dt>单集</dt><dd>{summary.itemCount}</dd></div>
            <div><dt>季</dt><dd>{summary.seasonCount || "—"}</dd></div>
            <div><dt>已看</dt><dd>{summary.watchedCount}</dd></div>
            <div><dt>总时长</dt><dd>{summary.totalDurationMs ? formatDuration(summary.totalDurationMs) : "—"}</dd></div>
          </dl>
          <span className="library-progress-track" aria-label={`整体观看进度 ${progress}%`}>
            <i style={{ width: `${progress}%` }} />
          </span>
          <small>整体进度 {progress}%</small>
        </aside>

        <section className="library-episodes" aria-labelledby="episodes-heading">
          <div className="library-section-heading">
            <div>
              <h2 id="episodes-heading">单集</h2>
              <p>播放进度、字幕和学习资料按单集保存。</p>
            </div>
            {currentCollection.seasons.length ? (
              <select
                aria-label="选择季"
                value={props.selectedSeason ?? "all"}
                onChange={(event) =>
                  props.onSelectSeason(
                    event.target.value === "all" ? null : Number(event.target.value),
                  )
                }
              >
                <option value="all">全部季</option>
                {currentCollection.seasons.map((season) => (
                  <option
                    key={season.seasonNumber ?? "none"}
                    value={season.seasonNumber ?? "all"}
                  >
                    {season.seasonNumber === null
                      ? "未分季"
                      : `第 ${season.seasonNumber} 季`} · {season.episodeCount} 集
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {props.collectionLoading ? (
            <div className="library-loading"><span className="spinner" />正在读取单集…</div>
          ) : <PagedMediaList key={`${summary.id}:${props.selectedSeason ?? "all"}`} items={props.currentEpisodes} page={props.collectionPagination}
              empty={<div className="library-empty-panel"><strong>合集还是空的</strong><p>可从「未分类」将现有视频加入这个合集。</p></div>}
              renderItem={(media) => (
                <LibraryMediaItem
                  key={media.projectId}
                  media={media}
                  context={{
                    kind: "collection",
                    collectionId: summary.id,
                    canRemove: summary.rootId === null,
                  }}
                  mutationPending={props.mutationPending}
                  onOpen={props.onOpen}
                  onRelink={props.onRelink}
                  onDelete={props.onDelete}
                  onOpenLocation={props.onOpenLocation}
                  onAddToCollection={props.onAddToCollection}
                  onRemoveFromCollection={props.onRemoveFromCollection}
                  onSetWatchLater={props.onSetWatchLater}
                  onSetWatched={props.onSetWatched}
                />
              )} />}
        </section>
      </div>
    </div>
  );
}

export function LibrarySeriesView(props: LibrarySeriesViewProps) {
  if (props.currentCollection) return <CollectionDetailView {...props} />;

  return (
    <div className="library-page library-series-page">
      <header className="library-page-heading">
        <div>
          <p className="library-eyebrow">媒体库</p>
          <h1>剧集</h1>
          <p>文件夹识别的剧集与手动整理的合集各自保留管理边界。</p>
        </div>
        <button className="library-heading-primary" type="button" onClick={props.onCreateCollection}>
          新建合集
        </button>
      </header>
      <CollectionOverviewGroup
        title="文件夹剧集"
        description="由授权文件夹识别并保持目录关联"
        rootLinked={true} refreshKey={props.refreshKey} readCollections={props.readCollections}
        onOpenCollection={props.onOpenCollection}
      />
      <CollectionOverviewGroup
        title="自建合集"
        description="手动整理现有视频，不复制源文件"
        rootLinked={false} refreshKey={props.refreshKey} readCollections={props.readCollections}
        onOpenCollection={props.onOpenCollection}
      />
    </div>
  );
}
