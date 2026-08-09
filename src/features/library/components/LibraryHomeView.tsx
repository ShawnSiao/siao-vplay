import { playbackUrl } from "../../../lib/desktop";
import { fileExtension, formatDuration, formatRecentTime } from "../../../lib/format";
import type { CollectionSummary, LibraryHome, LibraryMediaSummary } from "../../../types";
import type { LibrarySectionPageState } from "../useLibraryController";
import { libraryMediaProgress } from "./libraryMediaPresentation";

type LibraryHomeViewProps = {
  home: LibraryHome;
  continuePage: LibrarySectionPageState;
  previewMode: boolean;
  onOpen: (media: LibraryMediaSummary) => void;
  onOpenCollection: (collectionId: string) => void;
  onSelectSeries: () => void;
  onImport: () => void;
  onLoadMore: () => void;
};

function CollectionPreview({
  collection,
  onOpen,
}: {
  collection: CollectionSummary;
  onOpen: () => void;
}) {
  const progress = collection.itemCount
    ? Math.round((collection.watchedCount / collection.itemCount) * 100)
    : 0;
  return (
    <button
      className="library-series-card"
      type="button"
      aria-label={`打开合集 ${collection.title}`}
      onClick={onOpen}
    >
      <span className="library-series-poster">
        {collection.posterPath ? (
          <img src={playbackUrl(collection.posterPath)} alt="" />
        ) : (
          <span aria-hidden="true">{collection.rootId ? "▦" : "▤"}</span>
        )}
      </span>
      <span className="library-series-card-copy">
        <strong>{collection.title}</strong>
        <small>
          {collection.itemCount} 集
          {collection.seasonCount ? ` · ${collection.seasonCount} 季` : ""}
        </small>
        <span className="library-progress-track" aria-label={`观看进度 ${progress}%`}>
          <i style={{ width: `${progress}%` }} />
        </span>
        <small>{collection.watchedCount} 集已看</small>
      </span>
    </button>
  );
}

export function LibraryHomeView({
  home,
  continuePage,
  previewMode,
  onOpen,
  onOpenCollection,
  onSelectSeries,
  onImport,
  onLoadMore,
}: LibraryHomeViewProps) {
  const continueItems = continuePage.items.length
    ? continuePage.items
    : home.continueWatching;
  const hero = continueItems[0] ?? null;
  const secondary = continueItems.slice(1);
  const collections = home.collections.filter(
    (collection) => collection.systemKey === null,
  );

  return (
    <div className="library-page library-home-page">
      <header className="library-page-heading">
        <div>
          <p className="library-eyebrow">媒体库</p>
          <h1>继续观看</h1>
          <p>回到上次播放位置，或从最近整理的剧集开始。</p>
        </div>
      </header>

      {hero ? (
        <section className="library-continue-section" aria-labelledby="continue-heading">
          <h2 className="sr-only" id="continue-heading">最近观看</h2>
          <article className="library-continue-hero">
            <button
              className="library-continue-visual"
              type="button"
              aria-label={`打开最近观看的 ${hero.projectTitle}`}
              onClick={() => onOpen(hero)}
            >
              {hero.posterPath ? (
                <img src={playbackUrl(hero.posterPath)} alt="" />
              ) : (
                <span>{fileExtension(hero.displayName)}</span>
              )}
              <i className="library-continue-shade" aria-hidden="true" />
            </button>
            <div className="library-continue-copy">
              <span className="library-resume-label">最近观看</span>
              <h2>{hero.projectTitle}</h2>
              <p title={hero.displayName}>{hero.displayName}</p>
              <div className="library-continue-time">
                <span>{formatDuration(hero.positionMs)}</span>
                <span>{hero.durationMs ? formatDuration(hero.durationMs) : "时长未知"}</span>
              </div>
              <span className="library-progress-track" aria-label={`观看进度 ${libraryMediaProgress(hero)}%`}>
                <i style={{ width: `${libraryMediaProgress(hero)}%` }} />
              </span>
              <div className="library-continue-footer">
                <span>上次观看于 {formatRecentTime(hero.lastOpenedAtMs)}</span>
                <button type="button" onClick={() => onOpen(hero)}>继续播放</button>
              </div>
            </div>
          </article>

          {secondary.length || continuePage.nextOffset !== null ? (
            <div className="library-continue-strip" aria-label="其他观看中内容">
              {secondary.map((media) => (
                <button type="button" key={media.projectId} onClick={() => onOpen(media)}>
                  <span className="library-continue-strip-poster">
                    {media.posterPath ? (
                      <img src={playbackUrl(media.posterPath)} alt="" />
                    ) : (
                      <span>{fileExtension(media.displayName)}</span>
                    )}
                    <i style={{ width: `${libraryMediaProgress(media)}%` }} />
                  </span>
                  <strong>{media.projectTitle}</strong>
                  <small>从 {formatDuration(media.positionMs)} 继续</small>
                </button>
              ))}
              {continuePage.nextOffset !== null ? (
                <button
                  className="library-load-more-card"
                  type="button"
                  disabled={continuePage.loadingMore}
                  onClick={onLoadMore}
                >
                  <span>{continuePage.loadingMore ? "正在加载…" : "加载更多"}</span>
                  <small>
                    已显示 {continueItems.length} / {continuePage.totalCount}
                  </small>
                </button>
              ) : null}
            </div>
          ) : null}
          {continuePage.error ? <p className="library-inline-error" role="alert">{continuePage.error}</p> : null}
        </section>
      ) : (
        <section className="library-empty-resume">
          <div aria-hidden="true">▶</div>
          <span>
            <strong>还没有观看记录</strong>
            <p>{previewMode ? "桌面应用会显示真实观看进度。" : "添加视频后，播放位置会保存在当前设备。"}</p>
          </span>
          <button type="button" onClick={onImport}>添加视频</button>
        </section>
      )}

      <section className="library-section" aria-labelledby="home-series-title">
        <div className="library-section-heading">
          <div>
            <h2 id="home-series-title">剧集概览</h2>
            <p>文件夹剧集与自建合集</p>
          </div>
          <button type="button" onClick={onSelectSeries}>查看全部</button>
        </div>
        {collections.length ? (
          <div className="library-series-preview-grid">
            {collections.slice(0, 4).map((collection) => (
              <CollectionPreview
                key={collection.id}
                collection={collection}
                onOpen={() => onOpenCollection(collection.id)}
              />
            ))}
          </div>
        ) : (
          <div className="library-empty-panel">
            <strong>尚未建立剧集或合集</strong>
            <p>可通过「添加视频」导入剧集文件夹，或在剧集页新建合集。</p>
          </div>
        )}
      </section>

      <section className="library-section" aria-labelledby="recent-title">
        <div className="library-section-heading">
          <div>
            <h2 id="recent-title">最近加入</h2>
            <p>最近进入媒体库的内容</p>
          </div>
        </div>
        {home.recentlyAdded.length ? (
          <div className="library-recent-grid">
            {home.recentlyAdded.slice(0, 4).map((media) => (
              <button
                type="button"
                key={media.projectId}
                aria-label={`打开最近加入的 ${media.projectTitle}`}
                onClick={() => onOpen(media)}
              >
                <span>
                  {media.posterPath ? (
                    <img src={playbackUrl(media.posterPath)} alt="" />
                  ) : (
                    <i>{fileExtension(media.displayName)}</i>
                  )}
                </span>
                <strong>{media.projectTitle}</strong>
                <small>{formatRecentTime(media.createdAtMs)}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="library-empty-panel compact">还没有最近加入的视频。</div>
        )}
      </section>
    </div>
  );
}
