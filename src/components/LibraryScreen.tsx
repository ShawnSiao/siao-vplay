import { useState } from "react";

import { LibraryFoldersView } from "../features/library/components/LibraryFoldersView";
import { LibraryHomeView } from "../features/library/components/LibraryHomeView";
import { LibraryMediaListView } from "../features/library/components/LibraryMediaListView";
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
  onReloadSection: (
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
          <LibraryFoldersView
            folders={props.home.folders}
            onImportFolder={props.onImportFolder}
            onRescanRoot={props.onRescanRoot}
            onRelocateRoot={props.onRelocateRoot}
            onRebuildRoot={props.onRebuildRoot}
            onRequestRevoke={setRevokeRootId}
          />
        ) : null}

        {props.section === "watch_later" && !props.currentCollection ? (
          <LibraryMediaListView
            kind="watch_later"
            page={props.sectionPages.watch_later}
            onRetry={() => props.onReloadSection("watch_later")}
            onLoadMore={() => props.onLoadMoreSection("watch_later")}
            {...commonMediaProps}
          />
        ) : null}

        {props.section === "unclassified" && !props.currentCollection ? (
          <LibraryMediaListView
            kind="unclassified"
            page={props.sectionPages.unclassified}
            onRetry={() => props.onReloadSection("unclassified")}
            onLoadMore={() => props.onLoadMoreSection("unclassified")}
            {...commonMediaProps}
          />
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
