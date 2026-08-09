import "./LibraryAddMediaMenu.css";

type LibraryAddMediaMenuProps = {
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenUrl: () => void;
};

export function LibraryAddMediaMenu({
  onOpenFile,
  onOpenFolder,
  onOpenUrl,
}: LibraryAddMediaMenuProps) {
  const run = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: () => void,
  ) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
    action();
  };

  return (
    <details className="shell-add-media">
      <summary className="shell-command shell-command-primary">
        <span aria-hidden="true">＋</span>
        <span>添加视频</span>
      </summary>
      <div className="shell-overflow-menu shell-add-media-menu" role="menu">
        <button
          aria-keyshortcuts="Control+O"
          type="button"
          role="menuitem"
          onClick={(event) => run(event, onOpenFile)}
        >
          <span>打开视频</span>
          <small>Ctrl+O</small>
        </button>
        <button
          aria-keyshortcuts="Control+Shift+O"
          type="button"
          role="menuitem"
          onClick={(event) => run(event, onOpenFolder)}
        >
          <span>添加剧集文件夹</span>
          <small>Ctrl+Shift+O</small>
        </button>
        <button type="button" role="menuitem" onClick={(event) => run(event, onOpenUrl)}>
          <span>从 URL 导入</span>
          <small>公开媒体地址</small>
        </button>
      </div>
    </details>
  );
}
