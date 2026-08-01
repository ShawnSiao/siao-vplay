import { useEffect, useRef, type RefObject } from "react";

import type { ShellContextMenu } from "../shell/useShellController";

type PlayerContextMenuProps = {
  position: ShellContextMenu;
  playing: boolean;
  muted: boolean;
  fullscreen: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onTogglePlayback: () => void;
  onToggleMuted: () => void;
  onToggleFullscreen: () => void;
  onManageSubtitles: () => void;
  onBack: () => void;
};

export function PlayerContextMenu({
  position,
  playing,
  muted,
  fullscreen,
  returnFocusRef,
  onClose,
  onTogglePlayback,
  onToggleMuted,
  onToggleFullscreen,
  onManageSubtitles,
  onBack,
}: PlayerContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current;
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    return () => returnFocusTarget?.focus();
  }, [returnFocusRef]);

  const activate = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div
      ref={menuRef}
      className="player-context-menu"
      role="menu"
      aria-label="播放器右键菜单"
      aria-orientation="vertical"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(
            "[role='menuitem']",
          ) ?? [],
        );
        const currentIndex = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        let nextIndex: number | null = null;
        if (event.key === "ArrowDown") {
          nextIndex = (currentIndex + 1) % items.length;
        } else if (event.key === "ArrowUp") {
          nextIndex = (currentIndex - 1 + items.length) % items.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = items.length - 1;
        } else if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (nextIndex !== null && items[nextIndex]) {
          event.preventDefault();
          event.stopPropagation();
          items[nextIndex].focus();
        }
      }}
    >
      <button
        role="menuitem"
        type="button"
        onClick={() => activate(onTogglePlayback)}
      >
        {playing ? "暂停" : "播放"}
        <span>Space</span>
      </button>
      <button
        role="menuitem"
        type="button"
        onClick={() => activate(onToggleMuted)}
      >
        {muted ? "取消静音" : "静音"}
        <span>M</span>
      </button>
      <button
        role="menuitem"
        type="button"
        onClick={() => activate(onToggleFullscreen)}
      >
        {fullscreen ? "退出全屏" : "全屏"}
        <span>F</span>
      </button>
      <span className="context-menu-divider" role="separator" />
      <button
        role="menuitem"
        type="button"
        onClick={() => activate(onManageSubtitles)}
      >
        字幕设置
      </button>
      <button role="menuitem" type="button" onClick={() => activate(onBack)}>
        返回媒体库
      </button>
    </div>
  );
}
