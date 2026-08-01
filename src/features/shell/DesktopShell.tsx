import type { ReactNode } from "react";

import type { AppStatus, MediaRuntimeStatus } from "../../types";
import type { MediaDropFeedback } from "./useDesktopMediaDrop";
import type { ShellDrawerTab, ShellView } from "./useShellController";

type DesktopShellProps = {
  activeView: ShellView;
  navigationCollapsed: boolean;
  drawerTab: ShellDrawerTab | null;
  dropFeedback: MediaDropFeedback | null;
  appStatus: AppStatus | null;
  runtimeStatus: MediaRuntimeStatus | null;
  previewMode: boolean;
  mediaTitle: string | null;
  currentSubtitleCount: number | null;
  currentTranslationCount: number | null;
  canReviseSubtitles: boolean;
  canDeliverSubtitles: boolean;
  onToggleNavigation: () => void;
  onToggleDrawer: (tab: ShellDrawerTab) => void;
  onGoLibrary: () => void;
  onOpenFile: () => void;
  onOpenUrl: () => void;
  onManageSubtitles: () => void;
  onManageTranslation: () => void;
  onReviseSubtitles: () => void;
  onDeliverSubtitles: () => void;
  children: ReactNode;
};

export function DesktopShell({
  activeView,
  navigationCollapsed,
  drawerTab,
  dropFeedback,
  appStatus,
  runtimeStatus,
  previewMode,
  mediaTitle,
  currentSubtitleCount,
  currentTranslationCount,
  canReviseSubtitles,
  canDeliverSubtitles,
  onToggleNavigation,
  onToggleDrawer,
  onGoLibrary,
  onOpenFile,
  onOpenUrl,
  onManageSubtitles,
  onManageTranslation,
  onReviseSubtitles,
  onDeliverSubtitles,
  children,
}: DesktopShellProps) {
  const playerActive = activeView === "player";
  const runtimeLabel = previewMode
    ? "浏览器预览"
    : runtimeStatus?.available
      ? "本地媒体工具可用"
      : "正在检查媒体工具";

  return (
    <div
      className={`desktop-shell desktop-shell-${activeView} ${
        navigationCollapsed ? "navigation-collapsed" : ""
      }`}
    >
      <header className="desktop-commandbar" aria-label="应用命令栏">
        <div className="desktop-commandbar-primary">
          {!playerActive ? (
            <button
              aria-label={navigationCollapsed ? "展开媒体库导航" : "折叠媒体库导航"}
              className="shell-icon-command"
              type="button"
              title={navigationCollapsed ? "展开媒体库导航" : "折叠媒体库导航"}
              onClick={onToggleNavigation}
            >
              ☰
            </button>
          ) : null}
          {activeView !== "library" ? (
            <button
              aria-label="返回媒体库"
              className="shell-command"
              type="button"
              onClick={onGoLibrary}
            >
              <span aria-hidden="true">‹</span>
              <span>媒体库</span>
            </button>
          ) : null}
          <span className="shell-command-divider" aria-hidden="true" />
          <button
            aria-label="打开文件"
            aria-keyshortcuts="Control+O"
            className="shell-command"
            type="button"
            onClick={onOpenFile}
          >
            <span aria-hidden="true">＋</span>
            <span>打开文件</span>
          </button>
          <span
            className="shell-disabled-command"
            title="文件夹与剧集导入将在 Phase 7D 启用"
          >
            <button
              aria-label="打开文件夹，文件夹与剧集导入将在 Phase 7D 启用"
              className="shell-command"
              type="button"
              disabled
            >
              <span aria-hidden="true">▰</span>
              <span>打开文件夹</span>
            </button>
          </span>
          <button
            aria-label="粘贴视频 URL"
            className="shell-command"
            type="button"
            title="打开 URL"
            onClick={onOpenUrl}
          >
            <span aria-hidden="true">↗</span>
            <span>打开 URL</span>
          </button>
          {playerActive ? (
            <>
              <span className="shell-command-divider" aria-hidden="true" />
              <button
                aria-label={
                  currentSubtitleCount === null
                    ? "添加字幕"
                    : `原文字幕 · ${currentSubtitleCount}`
                }
                className="shell-command"
                type="button"
                onClick={onManageSubtitles}
              >
                <span aria-hidden="true">CC</span>
                <span>字幕</span>
              </button>
              <details className="shell-overflow">
                <summary
                  aria-label="更多字幕与交付命令"
                  className="shell-icon-command"
                  title="更多命令"
                >
                  •••
                </summary>
                <div className="shell-overflow-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      onManageTranslation();
                    }}
                  >
                    <span>中文字幕</span>
                    <small>{currentTranslationCount ?? "未生成"}</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canReviseSubtitles}
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      onReviseSubtitles();
                    }}
                  >
                    <span>修正字幕</span>
                    <small>逐句与时间轴</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canDeliverSubtitles}
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      onDeliverSubtitles();
                    }}
                  >
                    <span>导出字幕与视频</span>
                    <small>交付</small>
                  </button>
                </div>
              </details>
              {drawerTab === null ? (
                <>
                  <span className="shell-command-divider" aria-hidden="true" />
                  {(
                    [
                      ["episodes", "剧集"],
                      ["understand", "理解"],
                      ["learn", "学习"],
                    ] as const
                  ).map(([tab, label]) => (
                    <button
                      aria-pressed="false"
                      className={`shell-drawer-command ${tab}`}
                      key={tab}
                      type="button"
                      onClick={() => onToggleDrawer(tab)}
                    >
                      {label}
                    </button>
                  ))}
                </>
              ) : null}
            </>
          ) : null}
        </div>
        {playerActive && drawerTab ? (
          <div className="desktop-commandbar-context" title={mediaTitle ?? undefined}>
            {mediaTitle}
          </div>
        ) : null}
      </header>

      <div className="desktop-workspace">
        <aside
          className={`desktop-navigation ${navigationCollapsed ? "collapsed" : ""}`}
          aria-label="媒体库导航"
        >
          <div className="desktop-navigation-section">媒体库</div>
          <nav>
            <button
              aria-label="媒体库：继续观看"
              className={activeView === "library" ? "active" : ""}
              type="button"
              title="继续观看"
              onClick={onGoLibrary}
            >
              <span aria-hidden="true">▶</span>
              <span className="desktop-navigation-label">继续观看</span>
            </button>
            <button
              aria-label="媒体库：剧集"
              type="button"
              title="剧集将在 Phase 7C 启用"
              disabled
            >
              <span aria-hidden="true">▦</span>
              <span className="desktop-navigation-label">剧集</span>
            </button>
            <button
              aria-label="媒体库：文件夹"
              type="button"
              title="文件夹将在 Phase 7D 启用"
              disabled
            >
              <span aria-hidden="true">▰</span>
              <span className="desktop-navigation-label">文件夹</span>
            </button>
            <button
              aria-label="媒体库：未归类视频"
              type="button"
              title="未归类视频"
              onClick={onGoLibrary}
            >
              <span aria-hidden="true">▸</span>
              <span className="desktop-navigation-label">未归类</span>
            </button>
          </nav>
          <div className="desktop-navigation-note">
            <strong>
              <span
                className={`navigation-status-dot ${runtimeStatus?.available ? "ready" : "warning"}`}
                aria-hidden="true"
              />
              {runtimeLabel}
            </strong>
            <span>
              文件夹与剧集导入将在后续阶段启用。
              {appStatus ? ` · v${appStatus.version}` : ""}
            </span>
          </div>
        </aside>
        <section className="desktop-content" aria-label="当前内容">
          {children}
        </section>
      </div>
      {dropFeedback ? (
        <div
          className={`desktop-drop-feedback ${dropFeedback.tone}`}
          role="status"
        >
          <span aria-hidden="true">
            {dropFeedback.tone === "ready"
              ? "＋"
              : dropFeedback.tone === "working"
                ? "…"
                : "!"}
          </span>
          <strong>{dropFeedback.message}</strong>
        </div>
      ) : null}
    </div>
  );
}
