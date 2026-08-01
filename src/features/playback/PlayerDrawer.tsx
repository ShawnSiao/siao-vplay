import type { ReactNode } from "react";

import type { ShellDrawerTab } from "../shell/useShellController";

type PlayerDrawerProps = {
  activeTab: ShellDrawerTab;
  mediaTitle: string;
  children: ReactNode;
  onSelectTab: (tab: ShellDrawerTab) => void;
  onClose: () => void;
};

const drawerTabs: ReadonlyArray<{
  id: ShellDrawerTab;
  label: string;
}> = [
  { id: "episodes", label: "剧集" },
  { id: "understand", label: "理解" },
  { id: "learn", label: "学习" },
];

export function PlayerDrawer({
  activeTab,
  mediaTitle,
  children,
  onSelectTab,
  onClose,
}: PlayerDrawerProps) {
  return (
    <aside className="player-drawer" aria-label="当前内容抽屉">
      <header className="player-drawer-header">
        <div>
          <span>当前内容</span>
          <strong title={mediaTitle}>{mediaTitle}</strong>
        </div>
        <button aria-label="关闭右侧抽屉" type="button" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="player-drawer-tabs" role="tablist" aria-label="播放器辅助面板">
        {drawerTabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={`${tab.id} ${activeTab === tab.id ? "active" : ""}`}
            key={tab.id}
            role="tab"
            type="button"
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="player-drawer-content" role="tabpanel">
        {children}
      </div>
    </aside>
  );
}
