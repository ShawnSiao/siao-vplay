import { useEpisodeListWindow } from "./useEpisodeListWindow";
import { formatDuration } from "../../lib/format";
import type { EpisodePagination } from "../library/useCollectionEpisodePages";
import "./episode-pagination.css";
import type {
  CollectionDetail,
  EpisodeNeighbors,
  EpisodeReference,
  LibraryMediaSummary,
} from "../../types";

type EpisodeDrawerProps = {
  pagination?: EpisodePagination;
  projectId: string;
  mediaTitle?: string;
  detail: CollectionDetail | null;
  episodes: LibraryMediaSummary[];
  neighbors: EpisodeNeighbors;
  loading: boolean;
  error: string | null;
  switching: boolean;
  playbackPositionMs: number;
  playbackDurationMs: number | null;
  onSwitch: (episode: EpisodeReference) => void;
};

function mediaReference(media: LibraryMediaSummary): EpisodeReference {
  return {
    projectId: media.projectId,
    displayTitle: media.episodeTitle ?? media.projectTitle,
    seasonNumber: media.seasonNumber,
    episodeNumber: media.episodeNumber,
    absoluteOrder: media.absoluteOrder ?? 0,
  };
}

export function EpisodeDrawer({
  pagination,
  projectId,
  mediaTitle,
  detail,
  episodes,
  neighbors,
  loading,
  error,
  switching,
  playbackPositionMs,
  playbackDurationMs,
  onSwitch,
}: EpisodeDrawerProps) {
  const { listRef, start, items, previous, next, loadMore } = useEpisodeListWindow(`${detail?.summary.id ?? "none"}:${projectId}`, episodes, projectId);
  const paginated = Boolean(pagination || previous || next);
  if (loading && !detail) {
    return <div className="player-drawer-empty"><span className="spinner" /><strong>正在读取剧集</strong></div>;
  }
  if (error) {
    return <div className="player-drawer-empty warning"><strong>剧集列表暂时不可用</strong><p>{error}</p>
      {pagination ? <button type="button" className="button quiet" onClick={pagination.reload}>重新加载剧集</button> : null}</div>;
  }
  if (!detail) {
    return <div className="player-drawer-empty"><strong>这是单个视频</strong><p>从剧集详情打开单集后，这里会显示当前季和上一集／下一集。</p></div>;
  }

  const currentEpisode = episodes.find((episode) => episode.projectId === projectId);
  const currentPositionMs = playbackPositionMs;
  const currentDurationMs = playbackDurationMs ?? currentEpisode?.durationMs ?? null;
  const progressPercent = currentDurationMs
    ? Math.min(100, Math.max(0, (currentPositionMs / currentDurationMs) * 100))
    : 0;
  const currentEpisodeLabel =
    currentEpisode?.seasonNumber !== null &&
    currentEpisode?.seasonNumber !== undefined &&
    currentEpisode?.episodeNumber !== null &&
    currentEpisode?.episodeNumber !== undefined
      ? `第 ${currentEpisode.seasonNumber} 季 · 第 ${currentEpisode.episodeNumber} 集`
      : "当前集";
  const currentState = currentEpisode?.completedAtMs
    ? "已看"
    : currentPositionMs > 0
      ? "进行中"
      : "未观看";

  return (
    <div className={paginated ? "episode-drawer has-pagination" : "episode-drawer"}>
      <header>
        <div className="episode-drawer-hero">
          <div>
            <span>当前集</span>
            <strong>{currentEpisodeLabel}</strong>
          </div>
          <span>{currentState}</span>
        </div>
        <div className="episode-drawer-progress-row">
          <span>
            <span className="episode-drawer-series">
              {detail.summary.title} · {currentEpisode?.episodeTitle ?? mediaTitle ?? "当前集"}
            </span>
            <strong>
              {formatDuration(currentPositionMs)} / {formatDuration(currentDurationMs)}
            </strong>
          </span>
        </div>
        <div className="episode-drawer-progress" aria-label="当前集播放进度">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <span className="episode-drawer-series">
          {detail.summary.itemCount} 集 · 自动连播{detail.summary.autoPlayNext ? "开启" : "关闭"}
        </span>
      </header>
      <div className="episode-neighbor-actions" aria-label="邻集操作">
        <button
          type="button"
          disabled={!neighbors.previous || switching}
          onClick={() => neighbors.previous && onSwitch(neighbors.previous)}
        >
          ‹ 上一集
        </button>
        <button
          type="button"
          disabled={!neighbors.next || switching}
          onClick={() => neighbors.next && onSwitch(neighbors.next)}
        >
          下一集 ›
        </button>
      </div>
      <div ref={listRef} tabIndex={-1} className="episode-drawer-list" aria-label="当前季剧集">
        {items.map((episode) => {
          const current = episode.projectId === projectId;
          return (
            <button
              className={current ? "current" : ""}
              type="button"
              key={episode.projectId}
              aria-current={current ? "true" : undefined}
              disabled={current || switching || !episode.mediaAvailable || episode.itemAvailability !== "available"}
              onClick={() => onSwitch(mediaReference(episode))}
            >
              <span className="episode-drawer-number">
                {episode.episodeNumber === null ? "—" : String(episode.episodeNumber).padStart(2, "0")}
              </span>
              <span className="episode-drawer-title">
                <strong>{episode.episodeTitle ?? episode.projectTitle}</strong>
                <small>
                  {current
                    ? "正在播放"
                    : episode.completedAtMs
                      ? "已看"
                      : episode.positionMs > 0
                        ? `看到 ${formatDuration(episode.positionMs)}`
                        : episode.itemAvailability === "available"
                          ? "未观看"
                          : "文件不可用"}
                </small>
              </span>
              <span aria-hidden="true">{current ? "▶" : episode.completedAtMs ? "✓" : ""}</span>
            </button>
          );
        })}
      </div>
      {paginated ? <div className="episode-pagination">
        <p role="status">{pagination?.loading ? "正在读取剧集…" : pagination?.error && episodes.length === 0
          ? "未能读取剧集" : `已显示 ${start ? `${start + 1}–${start + items.length}` : items.length} / ${pagination?.totalCount ?? episodes.length} 集`}</p>
        {pagination?.error ? <p role="alert">{pagination.error}</p> : null}
        {previous || next || (pagination && (pagination.nextOffset !== null || pagination.error)) ? <div className="episode-pagination-actions">
        {previous ? <button type="button" className="button quiet" onClick={previous}>上一页剧集</button> : null}
        {next ? <button type="button" className="button quiet" onClick={next}>下一页剧集</button> : null}
        {pagination && !next && pagination.nextOffset !== null ? <button type="button" className="button quiet" disabled={pagination.loading}
          onClick={() => { void loadMore(pagination.loadMore); }}>{pagination.error ? "重试加载更多" : "加载更多剧集"}</button> : null}
        {pagination?.error ? <button type="button" className="button quiet" disabled={pagination.loading}
          onClick={pagination.reload}>重新加载剧集</button> : null}
        </div> : null}
      </div> : null}
    </div>
  );
}
