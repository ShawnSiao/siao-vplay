import { MenuPopover } from "../../../components/MenuPopover";
import { playbackUrl } from "../../../lib/desktop";
import { fileExtension, formatDuration, formatRecentTime } from "../../../lib/format";
import type { CollectionSummary, LibraryMediaSummary } from "../../../types";
import {
  libraryMediaNeedsRelink,
  libraryMediaProgress,
} from "./libraryMediaPresentation";

export type LibraryMediaItemContext =
  | { kind: "collection"; collectionId: string; canRemove: boolean }
  | { kind: "watch_later" }
  | { kind: "unclassified" };

type LibraryMediaItemProps = {
  media: LibraryMediaSummary;
  collections: CollectionSummary[];
  context: LibraryMediaItemContext;
  mutationPending: boolean;
  onOpen: (media: LibraryMediaSummary) => void;
  onRelink: (media: LibraryMediaSummary) => void;
  onDelete: (media: LibraryMediaSummary) => void;
  onOpenLocation: (media: LibraryMediaSummary) => void;
  onAddToCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onRemoveFromCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onSetWatchLater: (projectId: string, enabled: boolean) => Promise<unknown>;
  onSetWatched: (projectId: string, watched: boolean) => Promise<unknown>;
};

function episodeCode(media: LibraryMediaSummary): string | null {
  if (media.seasonNumber === null && media.episodeNumber === null) {
    return null;
  }
  return [
    media.seasonNumber === null
      ? null
      : `S${String(media.seasonNumber).padStart(2, "0")}`,
    media.episodeNumber === null
      ? null
      : `E${String(media.episodeNumber).padStart(2, "0")}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function mediaStatus(media: LibraryMediaSummary): string {
  if (media.itemAvailability === "changed") return "内容已变化";
  if (media.itemAvailability === "root_offline") return "文件夹离线";
  if (media.itemAvailability === "missing") return "文件缺失";
  if (!media.mediaAvailable) return "需要重新定位";
  if (media.completedAtMs) return "已看完";
  if (media.positionMs > 0) return "观看中";
  return "未观看";
}

export function LibraryMediaItem({
  media,
  collections,
  context,
  mutationPending,
  onOpen,
  onRelink,
  onDelete,
  onOpenLocation,
  onAddToCollection,
  onRemoveFromCollection,
  onSetWatchLater,
  onSetWatched,
}: LibraryMediaItemProps) {
  const needsRelink = libraryMediaNeedsRelink(media);
  const progress = libraryMediaProgress(media);
  const manualCollections = collections.filter(
    (collection) =>
      collection.systemKey === null && collection.id !== media.collectionId,
  );
  const primaryLabel = needsRelink
    ? "重新定位"
    : media.positionMs > 0
      ? "继续"
      : "播放";
  const code = episodeCode(media);

  return (
    <article data-project-id={media.projectId} className="library-media-item" data-has-poster={Boolean(media.posterPath)}>
      <button
        className="library-media-poster"
        type="button"
        aria-label={`${primaryLabel} ${media.projectTitle}`}
        onClick={() => (needsRelink ? onRelink(media) : onOpen(media))}
      >
        {media.posterPath ? (
          <img src={playbackUrl(media.posterPath)} alt="" />
        ) : (
          <span>{fileExtension(media.displayName)}</span>
        )}
        {progress > 0 ? (
          <i className="library-media-poster-progress" aria-hidden="true">
            <i style={{ width: `${progress}%` }} />
          </i>
        ) : null}
      </button>

      <div className="library-media-copy">
        <div className="library-media-title-line">
          {code ? <span className="library-episode-code">{code}</span> : null}
          <strong>{media.episodeTitle ?? media.projectTitle}</strong>
        </div>
        <p title={media.displayName}>{media.displayName}</p>
        <div className="library-media-meta">
          <span className={needsRelink ? "warning" : ""}>{mediaStatus(media)}</span>
          <span>
            {media.positionMs > 0
              ? `${formatDuration(media.positionMs)} / ${
                  media.durationMs ? formatDuration(media.durationMs) : "--:--"
                }`
              : media.durationMs
                ? formatDuration(media.durationMs)
                : "时长未知"}
          </span>
          <span>{formatRecentTime(media.lastOpenedAtMs)}</span>
        </div>
      </div>

      <div className="library-media-actions">
        <button
          className="library-primary-action"
          type="button"
          onClick={() => (needsRelink ? onRelink(media) : onOpen(media))}
        >
          {primaryLabel}
        </button>
        <MenuPopover
          className="library-row-menu"
          label={`${media.projectTitle} 的更多操作`}
          panelClassName="library-row-menu-panel"
        >
            <button type="button" role="menuitem" disabled={mutationPending}
              onClick={() => void onSetWatched(media.projectId, !media.completedAtMs)}>
              {media.completedAtMs ? "标记为未看" : "标记为看完"}
            </button>
            {context.kind === "watch_later" ? (
              <button
                type="button"
                role="menuitem"
                disabled={mutationPending}
                onClick={() => void onSetWatchLater(media.projectId, false)}
              >
                取消稍后观看
              </button>
            ) : null}
            {context.kind === "collection" && context.canRemove ? (
              <button
                type="button"
                role="menuitem"
                disabled={mutationPending}
                onClick={() =>
                  void onRemoveFromCollection(context.collectionId, media.projectId)
                }
              >
                移出合集
              </button>
            ) : null}
            {context.kind === "unclassified" || context.kind === "watch_later" ? (
              manualCollections.map((collection) => (
                <button
                  type="button"
                  role="menuitem"
                  key={collection.id}
                  disabled={mutationPending}
                  onClick={() =>
                    void onAddToCollection(collection.id, media.projectId)
                  }
                >
                  加入「{collection.title}」
                </button>
              ))
            ) : null}
            {context.kind !== "watch_later" ? (
              <button
                type="button"
                role="menuitem"
                disabled={mutationPending}
                onClick={() => void onSetWatchLater(media.projectId, true)}
              >
                加入稍后观看
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={!media.mediaAvailable}
              onClick={() => onOpenLocation(media)}
            >
              打开位置
            </button>
            {context.kind === "unclassified" ? (
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => onDelete(media)}
              >
                删除视频
              </button>
            ) : null}
        </MenuPopover>
      </div>
    </article>
  );
}
