import { useState } from "react";

import { formatRecentTime } from "../lib/format";
import { LibraryHomeView } from "../features/library/components/LibraryHomeView";
import { LibraryMediaItem } from "../features/library/components/LibraryMediaItem";
import { LibrarySeriesView } from "../features/library/components/LibrarySeriesView";
import type {
  LibrarySection,
  LibrarySectionPages,
} from "../features/library/useLibraryController";
import type {
  CollectionDetail,
  LibraryCollectionDeletionResult,
  LibraryHome,
  LibraryMediaSummary,
} from "../types";
import { Dialog } from "./Dialog";
import "../features/library/library.css";

type LibraryScreenProps = {
  home: LibraryHome;
  section: LibrarySection;
  sectionPages: LibrarySectionPages;
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
  onRebuildRoot: (rootId: string, needsNewLocation: boolean) => void;
  onRevokeRoot: (rootId: string) => void;
  onOpen: (media: LibraryMediaSummary) => void;
  onRelink: (media: LibraryMediaSummary) => void;
  onDelete: (media: LibraryMediaSummary) => void;
  onOpenLocation: (media: LibraryMediaSummary) => void;
  onSelectSection: (section: LibrarySection) => void;
  onLoadMoreSection: (
    section: "continue_watching" | "watch_later" | "unclassified",
  ) => void;
  onOpenCollection: (collectionId: string) => void;
  onCloseCollection: () => void;
  onSelectSeason: (season: number | null) => void;
  onCreateCollection: (title: string) => Promise<unknown>;
  onUpdateCollection: (
    collectionId: string,
    values: { title?: string; autoPlayNext?: boolean },
  ) => Promise<unknown>;
  onDeleteCollection: (
    collectionId: string,
  ) => Promise<LibraryCollectionDeletionResult | null>;
  onAddToCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onRemoveFromCollection: (collectionId: string, projectId: string) => Promise<unknown>;
  onSetWatchLater: (projectId: string, enabled: boolean) => Promise<unknown>;
};

export function LibraryScreen(props: LibraryScreenProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [collectionTitle, setCollectionTitle] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revokeRootId, setRevokeRootId] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const watchLater = props.home.collections.find(
    (collection) => collection.systemKey === "watch_later",
  );

  const commonMediaProps = {
    collections: props.home.collections,
    mutationPending: props.mutationPending,
    onOpen: props.onOpen,
    onRelink: props.onRelink,
    onDelete: props.onDelete,
    onOpenLocation: props.onOpenLocation,
    onAddToCollection: props.onAddToCollection,
    onRemoveFromCollection: props.onRemoveFromCollection,
    onSetWatchLater: props.onSetWatchLater,
  };

  return (
    <div className="library-screen" data-screen-label="媒体库">
      <div className="library-scroll">
        {props.error ? (
          <div className="library-global-notice danger" role="alert">
            <strong>媒体库暂时无法读取</strong>
            <p>{props.error}</p>
          </div>
        ) : null}
        {deleteNotice ? (
          <div className="library-global-notice success" role="status">
            {deleteNotice}
          </div>
        ) : null}

        {props.section === "home" && !props.currentCollection ? (
          <LibraryHomeView
            home={props.home}
            continuePage={props.sectionPages.continue_watching}
            previewMode={props.previewMode}
            onOpen={props.onOpen}
            onOpenCollection={props.onOpenCollection}
            onSelectSeries={() => props.onSelectSection("series")}
            onImport={props.onImport}
            onLoadMore={() => props.onLoadMoreSection("continue_watching")}
          />
        ) : null}

        {props.section === "series" || props.currentCollection ? (
          <LibrarySeriesView
            home={props.home}
            currentCollection={props.currentCollection}
            currentEpisodes={props.currentEpisodes}
            selectedSeason={props.selectedSeason}
            collectionLoading={props.collectionLoading}
            onOpenCollection={props.onOpenCollection}
            onCloseCollection={props.onCloseCollection}
            onSelectSeason={props.onSelectSeason}
            onCreateCollection={() => setCreateOpen(true)}
            onEditCollection={() => {
              if (props.currentCollection) {
                setEditTitle(props.currentCollection.summary.title);
                setEditOpen(true);
              }
            }}
            onDeleteCollection={() => setDeleteOpen(true)}
            onToggleAutoPlay={() => {
              if (props.currentCollection) {
                void props.onUpdateCollection(props.currentCollection.summary.id, {
                  autoPlayNext: !props.currentCollection.summary.autoPlayNext,
                });
              }
            }}
            {...commonMediaProps}
          />
        ) : null}

        {props.section === "folders" && !props.currentCollection ? (
          <div className="library-page">
            <header className="library-page-heading">
              <div><p className="library-eyebrow">媒体库</p><h1>文件夹</h1><p>管理本地剧集目录的授权与关联状态。</p></div>
              <button className="library-heading-primary" type="button" onClick={props.onImportFolder}>添加剧集文件夹</button>
            </header>
            <section className="library-section">
              <div className="library-section-heading"><div><h2>授权文件夹</h2><p>源文件保持在原位置。</p></div><span>{props.home.folders.length} 个</span></div>
              {props.home.folders.length ? (
                <div className="library-folder-list">
                  {props.home.folders.map((folder) => (
                    <article className="library-folder-row" key={folder.id}>
                      <span className="library-folder-icon" aria-hidden="true">▰</span>
                      <span className="library-folder-copy"><strong>{folder.displayName}</strong><small title={folder.path}>{folder.path}</small></span>
                      <span>{folder.itemCount} 集</span>
                      <span className={folder.status === "linked" ? "ready" : "warning"}>{folder.status === "linked" ? "已关联" : folder.status === "orphaned" ? "待重建" : "需要人工整理"}</span>
                      <small>{folder.lastScannedAtMs ? `上次扫描 ${formatRecentTime(folder.lastScannedAtMs)}` : "尚未扫描"}</small>
                      <div className="library-folder-actions">
                        {folder.status === "linked" ? <button type="button" aria-label={`扫描更新 ${folder.displayName}`} onClick={() => props.onRescanRoot(folder.id)}>扫描更新</button> : null}
                        {folder.status === "orphaned" ? <button type="button" aria-label={`${folder.availability === "available" ? "重建剧集" : "选择位置并重建"} ${folder.displayName}`} onClick={() => props.onRebuildRoot(folder.id, folder.availability !== "available")}>{folder.availability === "available" ? "重建剧集" : "选择位置并重建"}</button> : null}
                        {folder.status === "linked" ? <button type="button" aria-label={`更换位置 ${folder.displayName}`} onClick={() => props.onRelocateRoot(folder.id)}>更换位置</button> : null}
                        {folder.status === "orphaned" ? <button type="button" aria-label={`撤销授权 ${folder.displayName}`} onClick={() => setRevokeRootId(folder.id)}>撤销授权</button> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="library-empty-panel"><strong>还没有授权文件夹</strong><p>添加文件夹后会先预检识别结果，再确认导入。</p></div>}
            </section>
          </div>
        ) : null}

        {props.section === "watch_later" && !props.currentCollection ? (
          <div className="library-page">
            <header className="library-page-heading"><div><p className="library-eyebrow">媒体库</p><h1>稍后观看</h1><p>{watchLater ? `${watchLater.itemCount} 个视频` : "还没有稍后观看的视频"}</p></div></header>
            {watchLater ? <button className="library-legacy-collection" type="button" onClick={() => props.onOpenCollection(watchLater.id)}><strong>{watchLater.title}</strong><span>{watchLater.itemCount} 个视频</span><span>打开列表 ›</span></button> : <div className="library-empty-panel">可从「未分类」将视频加入稍后观看。</div>}
          </div>
        ) : null}

        {props.section === "unclassified" && !props.currentCollection ? (
          <div className="library-page">
            <header className="library-page-heading"><div><p className="library-eyebrow">媒体库</p><h1>未分类</h1><p>{props.home.unclassifiedCount} 个视频尚未加入任何合集。</p></div></header>
            {props.loading ? <div className="library-loading"><span className="spinner" />正在读取视频…</div> : props.home.unclassified.length ? (
              <div className="library-media-list">
                {props.home.unclassified.map((media) => <LibraryMediaItem key={media.projectId} media={media} context={{ kind: "unclassified" }} {...commonMediaProps} />)}
              </div>
            ) : <div className="library-empty-panel"><strong>{props.home.totalProjectCount ? "所有视频都已分类" : "还没有本地视频"}</strong><p>可通过顶部「添加视频」导入本地媒体。</p></div>}
          </div>
        ) : null}
      </div>

      {createOpen ? (
        <Dialog eyebrow="媒体库" title="新建合集" onClose={() => setCreateOpen(false)} actions={<><button className="button quiet" type="button" onClick={() => setCreateOpen(false)}>取消</button><button className="button primary" type="submit" form="create-collection-form" disabled={props.mutationPending || !collectionTitle.trim()}>创建合集</button></>}>
          <form id="create-collection-form" onSubmit={(event) => { event.preventDefault(); void props.onCreateCollection(collectionTitle).then((created) => { if (created) { setCollectionTitle(""); setCreateOpen(false); } }); }}>
            <label className="library-dialog-field"><span>合集名称</span><input autoFocus value={collectionTitle} maxLength={200} onChange={(event) => setCollectionTitle(event.target.value)} placeholder="例如：周末电影" /></label>
            <p>合集只整理现有视频，不复制或修改源文件。</p>
          </form>
        </Dialog>
      ) : null}

      {editOpen && props.currentCollection ? (
        <Dialog eyebrow="合集设置" title="重命名合集" onClose={() => setEditOpen(false)} actions={<><button className="button quiet" type="button" onClick={() => setEditOpen(false)}>取消</button><button className="button primary" type="submit" form="edit-collection-form" disabled={props.mutationPending || !editTitle.trim()}>保存</button></>}>
          <form id="edit-collection-form" onSubmit={(event) => { event.preventDefault(); void props.onUpdateCollection(props.currentCollection!.summary.id, { title: editTitle }).then((updated) => { if (updated) setEditOpen(false); }); }}>
            <label className="library-dialog-field"><span>合集名称</span><input autoFocus value={editTitle} maxLength={200} onChange={(event) => setEditTitle(event.target.value)} /></label>
          </form>
        </Dialog>
      ) : null}

      {deleteOpen && props.currentCollection ? (
        <Dialog eyebrow="删除合集" title={`删除「${props.currentCollection.summary.title}」合集？`} onClose={() => setDeleteOpen(false)} actions={<><button className="button quiet" type="button" onClick={() => setDeleteOpen(false)}>取消</button><button className="button danger" type="button" disabled={props.mutationPending} onClick={() => void props.onDeleteCollection(props.currentCollection!.summary.id).then((result) => { if (result) { setDeleteOpen(false); setDeleteNotice(`已保留 ${result.preservedProjectCount} 个视频项目。${result.rootId ? "可在「文件夹」中重建剧集。" : ""}`); props.onSelectSection(result.rootId ? "folders" : "series"); } })}>确认删除合集</button></>}>
          <p>仅移除合集和归类关系。视频文件、播放进度、字幕和学习资料会保留。</p>
        </Dialog>
      ) : null}

      {revokeRootId ? (
        <Dialog eyebrow="文件夹" title="撤销文件夹授权？" onClose={() => setRevokeRootId(null)} actions={<><button className="button quiet" type="button" onClick={() => setRevokeRootId(null)}>取消</button><button className="button danger" type="button" onClick={() => { props.onRevokeRoot(revokeRootId); setRevokeRootId(null); }}>撤销授权</button></>}>
          <p>只移除文件夹授权和扫描关系，不删除源视频、播放进度、字幕或学习资料。</p>
        </Dialog>
      ) : null}
    </div>
  );
}
