import { useEffect, useState, type ReactNode } from "react";
import "./PlayerDrawer.css";

import type { ShellDrawerTab } from "../shell/useShellController";
import { useTabNavigation } from "../../components/useTabNavigation";

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
  { id: "transcript", label: "逐字稿", description: "完整字幕" },
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
  const tabs = useTabNavigation(activeTab, onSelectTab);

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
      data-active-tab={activeTab}
      data-density={density}
      aria-label="当前内容抽屉"
    >
      <header className="player-drawer-header" aria-label="当前观看上下文">
        <strong title={`${mediaTitle} · ${contextLabel}`}>{mediaTitle}</strong>
        <span className="player-drawer-context-status" title={contextStatus}>{contextStatus}</span>
        <button aria-label="关闭右侧抽屉" type="button" onClick={onClose}>×</button>
      </header>

      <div
        className="player-drawer-tabs"
        {...tabs.listProps}
        aria-label="播放器辅助面板"
      >
        {drawerTabs.map((tab) => (
          <button
            {...tabs.tabProps(tab.id)}
            aria-controls={`player-drawer-panel-${tab.id}`}
            aria-label={tab.label}
            title={tab.id === "episodes" ? episodeSummary : tab.description}
            className={`${tab.id} ${activeTab === tab.id ? "active" : ""}`}
            id={`player-drawer-tab-${tab.id}`}
            key={tab.id}
          >
            <span>{tab.label}</span>

          </button>
        ))}
      </div>

      <div
        className="player-drawer-content"
        id={`player-drawer-panel-${activeTab}`}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`player-drawer-tab-${activeTab}`}
      >
        {children}
      </div>
      {activeTab !== "transcript" ? (
        <details className="player-drawer-reading">
          <summary>阅读设置</summary>
          <div className="player-drawer-density" role="group" aria-label="切换阅读密度">
            {(["comfortable", "compact"] as const).map((value) => (
              <button key={value} aria-pressed={density === value} type="button" onClick={() => setDensity(value)}>
                {value === "comfortable" ? "舒适" : "紧凑"}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </aside>
  );
}
