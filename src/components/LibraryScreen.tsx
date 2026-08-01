import { useMemo, useState } from "react";

import type { LibrarySection } from "../features/library/useLibraryController";
import { playbackUrl } from "../lib/desktop";
import { fileExtension, formatDuration, formatRecentTime } from "../lib/format";
import type {
  CollectionDetail,
  CollectionSummary,
  LibraryHome,
  LibraryMediaSummary,
} from "../types";
import { Dialog } from "./Dialog";

type LibraryScreenProps = {
  home: LibraryHome;
  section: LibrarySection;
  currentCollection: CollectionDetail | null;
  currentEpisodes: LibraryMediaSummary[];
  selectedSeason: number | null;
  loading: boolean;
  collectionLoading: boolean;
  mutationPending: boolean;
  error: string | null;
  previewMode: boolean;
  onImport: () => void;
  onImportFolder: () => void;
  onImportUrl: () => void;
  onRescanRoot: (rootId: string) => void;
  onRelocateRoot: (rootId: string) => void;
  onOpen: (media: LibraryMediaSummary) => void;
  onRelink: (media: LibraryMediaSummary) => void;
  onDelete: (media: LibraryMediaSummary) => void;
  onOpenLocation: (media: LibraryMediaSummary) => void;
  onSelectSection: (section: LibrarySection) => void;
  onOpenCollection: (collectionId: string) => void;
  onCloseCollection: () => void;
  onSelectSeason: (season: number | null) => void;
  onCreateCollection: (title: string) => Promise<unknown>;
  onUpdateCollection: (
    collectionId: string,
    values: { title?: string; autoPlayNext?: boolean },
  ) => Promise<unknown>;
  onDeleteCollection: (collectionId: string) => Promise<unknown>;
  onAddToCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onRemoveFromCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onSetWatchLater: (projectId: string, enabled: boolean) => Promise<unknown>;
};

function mediaLocation(media: LibraryMediaSummary): string {
  const separatorIndex = Math.max(
    media.mediaLocator.lastIndexOf("\\"),
    media.mediaLocator.lastIndexOf("/"),
  );
  return separatorIndex > 0
    ? media.mediaLocator.slice(0, separatorIndex)
    : "本地文件";
}

function mediaProgress(media: LibraryMediaSummary): number {
  return media.durationMs && media.durationMs > 0
    ? Math.round(Math.max(0, Math.min(100, (media.positionMs / media.durationMs) * 100)))
    : 0;
}

function MediaStatus({ media }: { media: LibraryMediaSummary }) {
  const unavailable =
    !media.mediaAvailable ||
    (media.itemAvailability !== null && media.itemAvailability !== "available");
  const status =
    media.itemAvailability === "changed"
      ? "内容已变化"
      : media.itemAvailability === "root_offline"
        ? "根目录离线"
        : media.itemAvailability === "missing"
          ? "文件缺失"
          : !media.mediaAvailable
            ? "需要重新定位"
            : media.completedAtMs
              ? "已看"
              : media.positionMs > 0
                ? "观看中"
                : "可以观看";
  return (
    <span className={`library-item-status ${unavailable ? "warning" : "ready"}`}>
      {status}
    </span>
  );
}

function MediaRow({
  media,
  collections,
  collectionContext,
  mutationPending,
  onOpen,
  onRelink,
  onDelete,
  onOpenLocation,
  onAddToCollection,
  onRemoveFromCollection,
  onSetWatchLater,
}: {
  media: LibraryMediaSummary;
  collections: CollectionSummary[];
  collectionContext: string | null;
  mutationPending: boolean;
  onOpen: (media: LibraryMediaSummary) => void;
  onRelink: (media: LibraryMediaSummary) => void;
  onDelete: (media: LibraryMediaSummary) => void;
  onOpenLocation: (media: LibraryMediaSummary) => void;
  onAddToCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onRemoveFromCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onSetWatchLater: (projectId: string, enabled: boolean) => Promise<unknown>;
}) {
  const [selectedCollection, setSelectedCollection] = useState("");
  const needsRelink =
    !media.mediaAvailable ||
    (media.itemAvailability !== null && media.itemAvailability !== "available");
  const progress = mediaProgress(media);
  const watchLater = collections.find((item) => item.systemKey === "watch_later");
  const isWatchLater = collectionContext === watchLater?.id;
  const manualCollections = collections.filter(
    (item) => item.systemKey === null && item.id !== collectionContext,
  );

  return (
    <article className="library-item-row">
      <button
        className="library-item-open"
        type="button"
        onClick={() => (needsRelink ? onRelink(media) : onOpen(media))}
        aria-label={`${needsRelink ? "重新定位" : "打开"} ${media.projectTitle}`}
      >
        <span className="library-file-kind">{fileExtension(media.displayName)}</span>
        <span className="library-item-title">
          <strong>{media.episodeTitle ?? media.projectTitle}</strong>
          <small title={media.displayName}>
            {media.seasonNumber === null ? "" : `S${String(media.seasonNumber).padStart(2, "0")} `}
            {media.episodeNumber === null ? "" : `E${String(media.episodeNumber).padStart(2, "0")} · `}
            {media.displayName}
          </small>
        </span>
      </button>
      <div className="library-item-progress">
        <div className="watch-progress" aria-label={`观看进度 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <span>
          {media.positionMs > 0 ? `看到 ${formatDuration(media.positionMs)}` : "未观看"}
          {media.durationMs ? ` / ${formatDuration(media.durationMs)}` : ""}
        </span>
      </div>
      <MediaStatus media={media} />
      <span className="library-item-recent">{formatRecentTime(media.lastOpenedAtMs)}</span>
      <div className="library-item-actions">
        {collectionContext ? (
          <button
            className="button quiet small"
            type="button"
            disabled={mutationPending}
            onClick={() => void onRemoveFromCollection(collectionContext, media.projectId)}
          >
            移出合集
          </button>
        ) : (
          <>
            <select
              aria-label={`将 ${media.projectTitle} 加入合集`}
              value={selectedCollection}
              disabled={mutationPending || manualCollections.length === 0}
              onChange={(event) => {
                const collectionId = event.target.value;
                setSelectedCollection("");
                if (collectionId) {
                  void onAddToCollection(collectionId, media.projectId);
                }
              }}
            >
              <option value="">加入合集…</option>
              {manualCollections.map((collection) => (
                <option value={collection.id} key={collection.id}>
                  {collection.title}
                </option>
              ))}
            </select>
            <button
              className="button quiet small"
              type="button"
              aria-label={`将 ${media.projectTitle} 加入稍后观看`}
              disabled={mutationPending}
              onClick={() => void onSetWatchLater(media.projectId, true)}
            >
              稍后
            </button>
          </>
        )}
        {isWatchLater ? (
          <button
            className="button quiet small"
            type="button"
            disabled={mutationPending}
            onClick={() => void onSetWatchLater(media.projectId, false)}
          >
            取消稍后观看
          </button>
        ) : null}
        <button
          className="button quiet small"
          type="button"
          disabled={!media.mediaAvailable}
          onClick={() => onOpenLocation(media)}
        >
          位置
        </button>
        {!collectionContext ? (
          <button className="button quiet small" type="button" onClick={() => onDelete(media)}>
            删除
          </button>
        ) : null}
        <button
          className={`button small ${needsRelink ? "" : "primary"}`}
          type="button"
          onClick={() => (needsRelink ? onRelink(media) : onOpen(media))}
        >
          {needsRelink ? "重新定位" : media.positionMs > 0 ? "继续" : "播放"}
        </button>
      </div>
    </article>
  );
}

function ContinueWatchingItem({
  media,
  onOpen,
}: {
  media: LibraryMediaSummary;
  onOpen: (media: LibraryMediaSummary) => void;
}) {
  const progress = mediaProgress(media);
  return (
    <button
      className="continue-item"
      type="button"
      aria-label={`继续播放 ${media.projectTitle}`}
      onClick={() => onOpen(media)}
    >
      <span className="continue-thumbnail">
        {media.posterPath ? (
          <img className="poster-image" src={playbackUrl(media.posterPath)} alt="" />
        ) : (
          <span className="poster-extension">{fileExtension(media.displayName)}</span>
        )}
      </span>
      <span className="continue-item-copy">
        <small className="continue-kicker">继续观看</small>
        <strong>{media.projectTitle}</strong>
        <small>
          {media.displayName} · {formatDuration(media.positionMs)}
          {media.durationMs ? ` / ${formatDuration(media.durationMs)}` : ""}
        </small>
        <small>上次观看于 {formatRecentTime(media.lastOpenedAtMs)}</small>
        <span className="watch-progress" aria-label={`继续观看进度 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </span>
      </span>
      <span className="continue-action">从 {formatDuration(media.positionMs)} 继续</span>
    </button>
  );
}

function CollectionCard({
  collection,
  onOpen,
}: {
  collection: CollectionSummary;
  onOpen: (collectionId: string) => void;
}) {
  const progress = collection.itemCount
    ? Math.round((collection.watchedCount / collection.itemCount) * 100)
    : 0;
  return (
    <button
      className="library-collection-card"
      type="button"
      onClick={() => onOpen(collection.id)}
      aria-label={`打开合集 ${collection.title}`}
    >
      <span className="library-collection-icon" aria-hidden="true">
        {collection.systemKey === "watch_later" ? "◷" : collection.kind === "series" ? "▦" : "▤"}
      </span>
      <span>
        <strong>{collection.title}</strong>
        <small>
          {collection.itemCount} 集{collection.seasonCount ? ` · ${collection.seasonCount} 季` : ""}
          {collection.totalDurationMs ? ` · ${formatDuration(collection.totalDurationMs)}` : ""}
        </small>
      </span>
      <span className="watch-progress" aria-label={`合集观看进度 ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </span>
      <small>{collection.watchedCount} 集已看</small>
    </button>
  );
}

export function LibraryScreen(props: LibraryScreenProps) {
  const {
    home,
    section,
    currentCollection,
    currentEpisodes,
    selectedSeason,
    loading,
    collectionLoading,
    mutationPending,
    error,
    previewMode,
    onImport,
    onImportFolder,
    onImportUrl,
    onRescanRoot,
    onRelocateRoot,
    onOpen,
    onRelink,
    onDelete,
    onOpenLocation,
    onSelectSection,
    onOpenCollection,
    onCloseCollection,
    onSelectSeason,
    onCreateCollection,
    onUpdateCollection,
    onDeleteCollection,
    onAddToCollection,
    onRemoveFromCollection,
    onSetWatchLater,
  } = props;
  const [createOpen, setCreateOpen] = useState(false);
  const [collectionTitle, setCollectionTitle] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const collections = useMemo(
    () => home.collections.filter((item) => item.systemKey === null),
    [home.collections],
  );
  const watchLater = home.collections.find((item) => item.systemKey === "watch_later") ?? null;
  const visibleCollections = section === "watch_later" ? (watchLater ? [watchLater] : []) : collections;
  const showHome = section === "home" && currentCollection === null;
  const showCollections = (section === "series" || section === "watch_later") && currentCollection === null;
  const showFolders = section === "folders" && currentCollection === null;
  const showUnclassified = (section === "unclassified" || section === "home") && currentCollection === null;
  const latestContinue = home.continueWatching[0] ?? null;

  return (
    <div className="library-screen" data-screen-label="媒体库">
      <div className="library-scroll">
        <main className="library-content">
          <header className="library-header">
            <div>
              <h1>{currentCollection?.summary.title ?? (section === "series" ? "剧集与合集" : section === "folders" ? "授权文件夹" : section === "watch_later" ? "稍后观看" : section === "unclassified" ? "未归类视频" : "媒体库")}</h1>
              <p>
                {currentCollection
                  ? `${currentCollection.summary.itemCount} 集 · 自动连播${currentCollection.summary.autoPlayNext ? "已开启" : "关闭"}`
                  : "本地视频、观看进度和字幕资料都保存在当前设备。"}
              </p>
            </div>
            <div className="library-header-actions">
              {currentCollection ? (
                <>
                  <button className="button quiet" type="button" onClick={onCloseCollection}>
                    返回合集
                  </button>
                  <button
                    className="button quiet"
                    type="button"
                    aria-pressed={currentCollection.summary.autoPlayNext}
                    disabled={mutationPending}
                    onClick={() =>
                      void onUpdateCollection(currentCollection.summary.id, {
                        autoPlayNext: !currentCollection.summary.autoPlayNext,
                      })
                    }
                  >
                    自动连播：{currentCollection.summary.autoPlayNext ? "开" : "关"}
                  </button>
                  {currentCollection.summary.systemKey === null ? (
                    <>
                      <button
                        className="button quiet"
                        type="button"
                        onClick={() => {
                          setEditTitle(currentCollection.summary.title);
                          setEditOpen(true);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        className="button danger"
                        type="button"
                        disabled={mutationPending}
                        onClick={() => void onDeleteCollection(currentCollection.summary.id)}
                      >
                        删除合集
                      </button>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    aria-label="打开剧集文件夹"
                    className="button primary"
                    type="button"
                    onClick={onImportFolder}
                  >
                    打开文件夹
                  </button>
                  <button className="button" type="button" onClick={() => setCreateOpen(true)}>
                    新建合集
                  </button>
                  {latestContinue ? (
                    <button
                      className="button primary"
                      type="button"
                      aria-label={`打开最近观看的 ${latestContinue.projectTitle}`}
                      onClick={() => onOpen(latestContinue)}
                    >
                      继续播放
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </header>

          {error ? (
            <div className="notice danger" role="alert">
              <strong>媒体库暂时无法读取</strong>
              <p>{error}</p>
            </div>
          ) : null}

          {currentCollection ? (
            <section className="project-section" aria-labelledby="episodes-title">
              <div className="section-heading">
                <div>
                  <h2 id="episodes-title">单集</h2>
                  <p>每一集保留独立的字幕、理解和学习资料。</p>
                </div>
                {currentCollection.seasons.length > 0 ? (
                  <select
                    aria-label="选择季"
                    value={selectedSeason ?? "all"}
                    onChange={(event) =>
                      onSelectSeason(event.target.value === "all" ? null : Number(event.target.value))
                    }
                  >
                    <option value="all">全部季</option>
                    {currentCollection.seasons.map((season) => (
                      <option key={season.seasonNumber ?? "none"} value={season.seasonNumber ?? "all"}>
                        {season.seasonNumber === null ? "未分季" : `第 ${season.seasonNumber} 季`} · {season.episodeCount} 集
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {collectionLoading ? (
                <div className="project-loading"><span className="spinner" /><span>正在读取单集…</span></div>
              ) : currentEpisodes.length ? (
                <div className="library-item-list">
                  {currentEpisodes.map((media) => (
                    <MediaRow
                      key={media.projectId}
                      media={media}
                      collections={home.collections}
                      collectionContext={currentCollection.summary.id}
                      mutationPending={mutationPending}
                      onOpen={onOpen}
                      onRelink={onRelink}
                      onDelete={onDelete}
                      onOpenLocation={onOpenLocation}
                      onAddToCollection={onAddToCollection}
                      onRemoveFromCollection={onRemoveFromCollection}
                      onSetWatchLater={onSetWatchLater}
                    />
                  ))}
                </div>
              ) : (
                <div className="library-series-empty"><strong>合集还是空的</strong><p>可在「未归类视频」中把现有视频加入这个合集。</p></div>
              )}
            </section>
          ) : null}

          {showHome && home.continueWatching.length > 0 ? (
            <section className="project-section continue-section" aria-labelledby="continue-title">
              <div className="section-heading"><h2 id="continue-title">继续观看</h2><span>{home.continueWatching.length} 个播放中内容</span></div>
              <div className="continue-grid">
                {home.continueWatching.slice(0, 4).map((media) => (
                  <ContinueWatchingItem key={media.projectId} media={media} onOpen={onOpen} />
                ))}
              </div>
            </section>
          ) : null}

          {showHome ? (
            <section className="project-section" aria-labelledby="series-title">
              <div className="section-heading">
                <h2 id="series-title">剧集</h2>
                <button className="section-link" type="button" onClick={() => onSelectSection("series")}>查看全部 ›</button>
              </div>
              {collections.length ? (
                <div className="library-collection-grid">
                  {collections.slice(0, 6).map((collection) => (
                    <CollectionCard key={collection.id} collection={collection} onOpen={onOpenCollection} />
                  ))}
                </div>
              ) : (
                <div className="library-series-empty"><strong>尚未建立剧集或合集</strong><p>打开本地剧集文件夹，先预检识别结果再确认导入。</p></div>
              )}
            </section>
          ) : null}

          {showCollections ? (
            <section className="project-section" aria-labelledby="collections-title">
              <div className="section-heading"><h2 id="collections-title">{section === "watch_later" ? "稍后观看" : "全部合集"}</h2><span>{visibleCollections.length} 个</span></div>
              {visibleCollections.length ? (
                <div className="library-collection-grid">
                  {visibleCollections.map((collection) => (
                    <CollectionCard key={collection.id} collection={collection} onOpen={onOpenCollection} />
                  ))}
                </div>
              ) : (
                <div className="library-series-empty"><strong>{section === "watch_later" ? "还没有稍后观看的视频" : "尚未建立合集"}</strong><p>{section === "watch_later" ? "可从未归类视频或播放器中加入。" : "使用右上角「新建合集」开始整理。"}</p></div>
              )}
            </section>
          ) : null}

          {showFolders ? (
            <section className="project-section" aria-labelledby="folders-title">
              <div className="section-heading">
                <div>
                  <h2 id="folders-title">授权文件夹</h2>
                  <p>只保存根目录和相对路径，不复制或修改视频。</p>
                </div>
                <span>{home.folders.length} 个</span>
              </div>
              {home.folders.length ? (
                <div className="library-folder-list">
                  {home.folders.map((folder) => (
                    <article className="library-folder-row" key={folder.id}>
                      <span className="library-folder-icon" aria-hidden="true">▰</span>
                      <span className="library-folder-title">
                        <strong>{folder.displayName}</strong>
                        <small title={folder.path}>{folder.path}</small>
                      </span>
                      <span>{folder.itemCount} 集</span>
                      <span className={`library-item-status ${folder.availability === "available" ? "ready" : "warning"}`}>
                        {folder.availability === "available" ? "可用" : "离线"}
                      </span>
                      <small>{folder.lastScannedAtMs ? `上次扫描 ${formatRecentTime(folder.lastScannedAtMs)}` : "尚未扫描"}</small>
                      <span className="library-folder-actions">
                        <button type="button" onClick={() => onRescanRoot(folder.id)} aria-label={`重新扫描 ${folder.displayName}`}>重新扫描</button>
                        <button type="button" onClick={() => onRelocateRoot(folder.id)} aria-label={`重新定位 ${folder.displayName}`}>重新定位</button>
                      </span>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="library-series-empty">
                  <strong>还没有授权文件夹</strong>
                  <p>选择本地剧集目录后，会先预检识别结果，再由用户确认导入。</p>
                  <button className="button primary" type="button" onClick={onImportFolder}>打开文件夹</button>
                </div>
              )}
            </section>
          ) : null}

          {showHome && home.unclassified.length > 0 ? (
            <section className="project-section" aria-labelledby="recent-title">
              <div className="section-heading"><div><h2 id="recent-title">最近加入</h2><p>尚未加入剧集或合集的视频</p></div><span>{Math.min(5, home.unclassified.length)} 个最近视频</span></div>
              <div className="recently-added-list">
                {home.unclassified.slice(0, 5).map((media) => (
                  <button className="recently-added-row" type="button" key={media.projectId} aria-label={`打开最近加入的 ${media.projectTitle}`} onClick={() => onOpen(media)}>
                    <span className="library-file-kind">{fileExtension(media.displayName)}</span>
                    <span className="recently-added-title"><strong>{media.projectTitle}</strong><small title={mediaLocation(media)}>{mediaLocation(media)}</small></span>
                    <MediaStatus media={media} />
                    <span className="library-item-recent">{formatRecentTime(media.createdAtMs)}</span>
                    <span className="recently-added-open" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {showUnclassified ? (
            <section className="project-section" aria-labelledby="projects-title">
              <div className="section-heading"><div><h2 id="projects-title">未归类视频</h2><p>可继续观看，或加入手动合集。</p></div><span>{home.unclassifiedCount} 个视频</span></div>
              {loading ? (
                <div className="project-loading" aria-live="polite"><span className="spinner" /><span>正在读取本地视频…</span></div>
              ) : home.unclassified.length === 0 ? (
                <div className="empty-library">
                  <div className="empty-glyph" aria-hidden="true">▶</div>
                  <h3>{previewMode ? "桌面应用会显示真实视频" : home.totalProjectCount ? "所有视频都已归类" : "还没有本地视频"}</h3>
                  <p>{previewMode ? "当前页面只用于检查界面，不会读取浏览器中的本地文件。" : "可从命令栏打开本地视频或公开媒体 URL。SiaoVPlay 不会修改源视频。"}</p>
                  <div className="empty-library-actions"><button className="button" type="button" onClick={onImportUrl}>打开 URL</button><button aria-keyshortcuts="Control+O" className="button primary" type="button" onClick={onImport}>打开视频</button></div>
                </div>
              ) : (
                <div className="library-item-list">
                  {home.unclassified.map((media) => (
                    <MediaRow
                      key={media.projectId}
                      media={media}
                      collections={home.collections}
                      collectionContext={null}
                      mutationPending={mutationPending}
                      onOpen={onOpen}
                      onRelink={onRelink}
                      onDelete={onDelete}
                      onOpenLocation={onOpenLocation}
                      onAddToCollection={onAddToCollection}
                      onRemoveFromCollection={onRemoveFromCollection}
                      onSetWatchLater={onSetWatchLater}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </main>
      </div>

      {createOpen ? (
        <Dialog
          eyebrow="媒体库"
          title="新建合集"
          onClose={() => setCreateOpen(false)}
          actions={<><button className="button quiet" type="button" onClick={() => setCreateOpen(false)}>取消</button><button className="button primary" type="submit" form="create-collection-form" disabled={mutationPending || !collectionTitle.trim()}>创建合集</button></>}
        >
          <form
            id="create-collection-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onCreateCollection(collectionTitle).then((created) => {
                if (created) {
                  setCollectionTitle("");
                  setCreateOpen(false);
                }
              });
            }}
          >
            <label className="library-dialog-field"><span>合集名称</span><input autoFocus value={collectionTitle} maxLength={200} onChange={(event) => setCollectionTitle(event.target.value)} placeholder="例如：周末电影" /></label>
            <p>合集只整理现有视频，不复制或修改源文件。</p>
          </form>
        </Dialog>
      ) : null}

      {editOpen && currentCollection ? (
        <Dialog
          eyebrow="合集设置"
          title="重命名合集"
          onClose={() => setEditOpen(false)}
          actions={<><button className="button quiet" type="button" onClick={() => setEditOpen(false)}>取消</button><button className="button primary" type="submit" form="edit-collection-form" disabled={mutationPending || !editTitle.trim()}>保存</button></>}
        >
          <form
            id="edit-collection-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onUpdateCollection(currentCollection.summary.id, { title: editTitle }).then((updated) => {
                if (updated) {
                  setEditOpen(false);
                }
              });
            }}
          >
            <label className="library-dialog-field"><span>合集名称</span><input autoFocus value={editTitle} maxLength={200} onChange={(event) => setEditTitle(event.target.value)} /></label>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
