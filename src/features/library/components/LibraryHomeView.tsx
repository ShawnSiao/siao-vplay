import { playbackUrl } from "../../../lib/desktop";
import { LibraryContinueWindow } from "./LibraryContinueWindow";
import type { LibraryCollectionPagination } from "../useLibraryCollectionPaging";
import { fileExtension, formatDuration, formatRecentTime } from "../../../lib/format";
import type { CollectionSummary, LibraryHome, LibraryMediaSummary } from "../../../types";
import type { LibrarySectionPageState } from "../useLibraryController";
import { libraryMediaProgress } from "./libraryMediaPresentation";
import "../library-first-run.css";

type LibraryHomeViewProps = {
  home: LibraryHome;
  continuePage: LibrarySectionPageState;
  pagination?: LibraryCollectionPagination;
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
      data-has-poster={Boolean(collection.posterPath)}
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
  pagination,
  previewMode,
  onOpen,
  onOpenCollection,
  onSelectSeries,
  onImport,
  onLoadMore,
}: LibraryHomeViewProps) {
  const continueItems = continuePage.initialized
    ? continuePage.items
    : home.continueWatching;
  const hero = continueItems[0] ?? null;
  const secondary = continueItems.slice(1);
  const collections = home.collections.filter(
    (collection) => collection.systemKey === null,
  );
  const firstRun =
    home.totalProjectCount === 0 &&
    home.folders.length === 0 &&
    collections.length === 0;

  if (firstRun) {
    return (
      <div className="library-first-run" aria-labelledby="library-first-run-title">
        <span className="library-first-run-mark" aria-hidden="true">▶</span>
        <h1 id="library-first-run-title">把海外视频变成可以连续看懂的内容</h1>
        <p>
          导入已有视频，准备原文字幕并生成简体中文字幕。视频、字幕、观看记录和设置默认只保存在本机。
        </p>
        <button className="library-first-run-action" type="button" onClick={onImport}>
          导入视频
        </button>
        <div className="library-first-run-sources" aria-label="支持的导入方式">
          <article>
            <strong>本地视频</strong>
            <span>选择单个视频文件，直接加入媒体库。</span>
          </article>
          <article>
            <strong>剧集文件夹</strong>
            <span>自动识别并整理有明确季集关系的内容。</span>
          </article>
          <article>
            <strong>公开链接</strong>
            <span>导入公开直链、HLS 或单个公开视频页面。</span>
          </article>
        </div>
        <small className="library-first-run-privacy">
          不上传本地视频；向 AI 服务发送字幕或关键帧前会单独确认。
        </small>
      </div>
    );
  }

  return (
    <div className="library-page library-home-page">
      <header className="library-home-context" aria-label="媒体库继续观看">
        <span>媒体库</span>
        <b aria-hidden="true">/</b>
        <strong aria-hidden="true">继续观看</strong>
        <h1 className="sr-only">继续观看</h1>
      </header>

      <LibraryContinueWindow pagination={pagination} count={continueItems.length}>
      {hero ? (
        <section className="library-continue-section" aria-labelledby="continue-heading">
          <h2 className="sr-only" id="continue-heading">最近观看</h2>
          <article className="library-continue-hero" data-has-poster={Boolean(hero.posterPath)}>
            <button
              className="library-continue-visual"
              type="button"
              aria-label={`打开${continuePage.offset ? "继续观看的" : "最近观看的"} ${hero.projectTitle}`}
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
              <span className="library-resume-label">{continuePage.offset ? "继续观看" : "最近观看"}</span>
              <h2 title={hero.displayName}>{hero.projectTitle}</h2>
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
                  <span className="library-continue-strip-poster" data-has-poster={Boolean(media.posterPath)}>
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
              {continuePage.nextOffset !== null && !pagination ? (
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
          {continuePage.error && !pagination ? <p className="library-inline-error" role="alert">{continuePage.error}</p> : null}
        </section>
      ) : (
        <section className="library-empty-resume">
          <div aria-hidden="true">▶</div>
          <span>
            <strong>{continuePage.totalCount > 0 ? "本页暂无观看记录" : "还没有观看记录"}</strong>
            <p>{previewMode ? "桌面应用会显示真实观看进度。" : "添加视频后，播放位置会保存在当前设备。"}</p>
          </span>
          <button type="button" onClick={onImport}>添加视频</button>
        </section>
      )}
      </LibraryContinueWindow>

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
                data-has-poster={Boolean(media.posterPath)}
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
