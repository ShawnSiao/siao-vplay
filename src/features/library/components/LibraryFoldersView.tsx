import { MenuPopover } from "../../../components/MenuPopover";
import { formatRecentTime } from "../../../lib/format";
import type { LibraryRootSummary } from "../../../types";

type LibraryFoldersViewProps = {
  folders: LibraryRootSummary[];
  onImportFolder: () => void;
  onRescanRoot: (rootId: string) => void;
  onRelocateRoot: (rootId: string) => void;
  onRebuildRoot: (rootId: string, needsNewLocation: boolean) => void;
  onRequestRevoke: (rootId: string) => void;
};

type FolderAction = {
  label: string;
  run: () => void;
};

function folderState(folder: LibraryRootSummary): {
  label: string;
  description: string;
  tone: "ready" | "warning";
} {
  if (folder.status === "ambiguous") {
    return {
      label: "需要人工整理",
      description: "当前文件夹关联多个剧集，自动操作已停用。",
      tone: "warning",
    };
  }
  if (folder.status === "orphaned") {
    return {
      label: folder.availability === "available" ? "待重建" : "待重建 · 离线",
      description: "授权仍保留，当前没有关联的剧集。",
      tone: "warning",
    };
  }
  if (folder.availability === "offline") {
    return {
      label: "暂时离线",
      description: "原位置当前不可访问，既有项目和资料仍保留。",
      tone: "warning",
    };
  }
  return {
    label: "已关联",
    description: folder.lastScannedAtMs
      ? `上次扫描 ${formatRecentTime(folder.lastScannedAtMs)}`
      : "尚未扫描",
    tone: "ready",
  };
}

function FolderRow({
  folder,
  onRescanRoot,
  onRelocateRoot,
  onRebuildRoot,
  onRequestRevoke,
}: Omit<LibraryFoldersViewProps, "folders" | "onImportFolder"> & {
  folder: LibraryRootSummary;
}) {
  const state = folderState(folder);
  let primary: FolderAction | null = null;
  if (folder.status === "linked" && folder.availability === "available") {
    primary = { label: "扫描更新", run: () => onRescanRoot(folder.id) };
  } else if (folder.status === "linked") {
    primary = { label: "重新定位", run: () => onRelocateRoot(folder.id) };
  } else if (folder.status === "orphaned" && folder.availability === "available") {
    primary = { label: "重建剧集", run: () => onRebuildRoot(folder.id, false) };
  } else if (folder.status === "orphaned") {
    primary = {
      label: "选择位置并重建",
      run: () => onRebuildRoot(folder.id, true),
    };
  }

  return (
    <article className="library-folder-row">
      <span className="library-folder-icon" aria-hidden="true">▰</span>
      <span className="library-folder-copy">
        <strong>{folder.displayName}</strong>
        <small title={folder.path}>{folder.path}</small>
      </span>
      <span className="library-folder-count">{folder.itemCount} 集</span>
      <span className={`library-folder-state ${state.tone}`}>{state.label}</span>
      <small className="library-folder-description">{state.description}</small>
      <div className="library-folder-row-actions">
        {primary ? (
          <button
            className="library-primary-action"
            type="button"
            aria-label={`${primary.label} ${folder.displayName}`}
            onClick={primary.run}
          >
            {primary.label}
          </button>
        ) : null}
        {folder.status !== "ambiguous" ? (
          <MenuPopover
            className="library-row-menu"
            label={`${folder.displayName} 的文件夹操作`}
            panelClassName="library-row-menu-panel"
          >
              {folder.status === "linked" && folder.availability === "available" ? (
                <button type="button" role="menuitem" onClick={() => onRelocateRoot(folder.id)}>
                  更换位置
                </button>
              ) : null}
              {folder.status === "linked" && folder.availability === "offline" ? (
                <button type="button" role="menuitem" onClick={() => onRescanRoot(folder.id)}>
                  检查离线状态
                </button>
              ) : null}
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => onRequestRevoke(folder.id)}
              >
                撤销授权
              </button>
          </MenuPopover>
        ) : null}
      </div>
    </article>
  );
}

export function LibraryFoldersView(props: LibraryFoldersViewProps) {
  return (
    <div className="library-page library-folders-page">
      <header className="library-page-heading">
        <div>
          <p className="library-eyebrow">媒体库</p>
          <h1>文件夹</h1>
          <p>管理本地剧集目录的授权与关联状态。</p>
        </div>
        <button className="library-heading-primary" type="button" onClick={props.onImportFolder}>
          添加剧集文件夹
        </button>
      </header>
      <section className="library-section" aria-labelledby="folders-heading">
        <div className="library-section-heading">
          <div>
            <h2 id="folders-heading">授权文件夹</h2>
            <p>只保存根目录和相对路径，不复制或修改视频。</p>
          </div>
          <span>{props.folders.length} 个</span>
        </div>
        {props.folders.length ? (
          <div className="library-folder-list">
            {props.folders.map((folder) => (
              <FolderRow key={folder.id} folder={folder} {...props} />
            ))}
          </div>
        ) : (
          <div className="library-empty-panel">
            <strong>还没有授权文件夹</strong>
            <p>添加文件夹后会先预检识别结果，再确认导入。</p>
          </div>
        )}
      </section>
    </div>
  );
}
