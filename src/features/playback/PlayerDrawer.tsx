import { useEffect, useState, type ReactNode } from "react";

import type { ShellDrawerTab } from "../shell/useShellController";

type PlayerDrawerProps = {
  activeTab: ShellDrawerTab;
  mediaTitle: string;
  contextLabel?: string;
  contextStatus?: string;
  episodeSummary?: string;
  children: ReactNode;
  onSelectTab: (tab: ShellDrawerTab) => void;
  onClose: () => void;
};

type DrawerDensity = "comfortable" | "compact";

const densityStorageKey = "siaovplay-drawer-density";

const drawerTabs: ReadonlyArray<{
  id: ShellDrawerTab;
  label: string;
  description: string;
}> = [
  { id: "episodes", label: "剧集", description: "当前季" },
  { id: "understand", label: "理解", description: "当前场景" },
  { id: "learn", label: "学习", description: "当前台词" },
];

function readDensity(): DrawerDensity {
  try {
    return window.localStorage.getItem(densityStorageKey) === "compact"
      ? "compact"
      : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function PlayerDrawer({
  activeTab,
  mediaTitle,
  contextLabel = "当前视频",
  contextStatus = "等待字幕",
  episodeSummary = "当前季",
  children,
  onSelectTab,
  onClose,
}: PlayerDrawerProps) {
  const [density, setDensity] = useState<DrawerDensity>(readDensity);

  useEffect(() => {
    try {
      window.localStorage.setItem(densityStorageKey, density);
    } catch {
      // The drawer remains usable when local storage is unavailable.
    }
  }, [density]);

  return (
    <aside
      className="player-drawer"
      data-density={density}
      aria-label="当前内容抽屉"
    >
      <header className="player-drawer-header">
        <div>
          <span>当前内容</span>
          <strong title={mediaTitle}>{mediaTitle}</strong>
        </div>
        <button aria-label="关闭右侧抽屉" type="button" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="player-drawer-meta" aria-label="当前观看上下文">
        <div>
          <span className="player-drawer-status-dot" aria-hidden="true" />
          <span>正在观看</span>
          <strong>{contextLabel}</strong>
        </div>
        <span>{contextStatus}</span>
      </div>

      <div
        className="player-drawer-tabs"
        role="tablist"
        aria-label="播放器辅助面板"
      >
        {drawerTabs.map((tab) => (
          <button
            aria-controls={`player-drawer-panel-${tab.id}`}
            aria-label={tab.label}
            aria-selected={activeTab === tab.id}
            className={`${tab.id} ${activeTab === tab.id ? "active" : ""}`}
            id={`player-drawer-tab-${tab.id}`}
            key={tab.id}
            role="tab"
            type="button"
            onClick={() => onSelectTab(tab.id)}
          >
            <span>{tab.label}</span>
            <small>{tab.id === "episodes" ? episodeSummary : tab.description}</small>
          </button>
        ))}
      </div>

      <div className="player-drawer-toolbar">
        <div>
          <span>阅读密度</span>
          <strong>{density === "compact" ? "紧凑" : "舒适"}</strong>
        </div>
        <div className="player-drawer-density" role="group" aria-label="切换阅读密度">
          <button
            aria-pressed={density === "comfortable"}
            type="button"
            onClick={() => setDensity("comfortable")}
          >
            舒适
          </button>
          <button
            aria-pressed={density === "compact"}
            type="button"
            onClick={() => setDensity("compact")}
          >
            紧凑
          </button>
        </div>
      </div>

      <div
        className="player-drawer-content"
        id={`player-drawer-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`player-drawer-tab-${activeTab}`}
      >
        {children}
      </div>
    </aside>
  );
}
