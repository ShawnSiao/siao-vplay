import { MenuPopover } from "../../components/MenuPopover";
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
  return (
    <div className="shell-add-media-wrap">
      <div className="shell-add-media-direct" aria-label="添加媒体">
        <button
          aria-keyshortcuts="Control+O"
          className="shell-command shell-command-primary"
          type="button"
          onClick={onOpenFile}
        >
          <span aria-hidden="true">＋</span><span>打开视频</span>
        </button>
        <button
          aria-keyshortcuts="Control+Shift+O"
          className="shell-command"
          type="button"
          onClick={onOpenFolder}
        >
          <span aria-hidden="true">▰</span><span>添加剧集文件夹</span>
        </button>
        <button className="shell-command" type="button" onClick={onOpenUrl}>
          <span aria-hidden="true">↗</span><span>从 URL 导入</span>
        </button>
      </div>
      <MenuPopover
        className="shell-add-media shell-add-media-compact"
        label="添加视频"
        triggerClassName="shell-command shell-command-primary"
        panelClassName="shell-overflow-menu shell-add-media-menu"
        trigger={<><span aria-hidden="true">＋</span><span>添加视频</span></>}
      >
        <button
          aria-keyshortcuts="Control+O"
          type="button"
          role="menuitem"
          onClick={onOpenFile}
        >
          <span>打开视频</span>
          <small>Ctrl+O</small>
        </button>
        <button
          aria-keyshortcuts="Control+Shift+O"
          type="button"
          role="menuitem"
          onClick={onOpenFolder}
        >
          <span>添加剧集文件夹</span>
          <small>Ctrl+Shift+O</small>
        </button>
        <button type="button" role="menuitem" onClick={onOpenUrl}>
          <span>从 URL 导入</span>
          <small>公开媒体地址</small>
        </button>
      </MenuPopover>
    </div>
  );
}
