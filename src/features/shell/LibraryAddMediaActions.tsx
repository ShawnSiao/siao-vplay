import "./LibraryAddMediaActions.css";

type LibraryAddMediaActionsProps = {
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenUrl: () => void;
};

export function LibraryAddMediaActions({
  onOpenFile,
  onOpenFolder,
  onOpenUrl,
}: LibraryAddMediaActionsProps) {
  return (
    <div className="shell-add-media-actions" aria-label="添加媒体">
      <button
        aria-keyshortcuts="Control+O"
        className="shell-command shell-command-primary"
        type="button"
        onClick={onOpenFile}
      >
        <span aria-hidden="true">▣</span>
        <span>打开本地视频</span>
      </button>
      <button
        aria-keyshortcuts="Control+Shift+O"
        className="shell-command"
        type="button"
        onClick={onOpenFolder}
      >
        <span aria-hidden="true">▰</span>
        <span>添加剧集文件夹</span>
      </button>
      <button className="shell-command" type="button" onClick={onOpenUrl}>
        <span aria-hidden="true">↗</span>
        <span>从公开链接导入</span>
      </button>
    </div>
  );
}
