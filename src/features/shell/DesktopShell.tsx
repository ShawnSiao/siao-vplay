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
          <button
            aria-label={navigationCollapsed ? "展开媒体库导航" : "折叠媒体库导航"}
            className="shell-icon-command"
            type="button"
            title={navigationCollapsed ? "展开媒体库导航" : "折叠媒体库导航"}
            onClick={onToggleNavigation}
          >
            ☰
          </button>
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
              <span aria-hidden="true">▱</span>
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
                <span>
                  {currentSubtitleCount === null
                    ? "原文字幕"
                    : `原文字幕 · ${currentSubtitleCount}`}
                </span>
              </button>
              <button
                aria-label={
                  currentTranslationCount === null
                    ? "生成中文字幕"
                    : `中文字幕 · ${currentTranslationCount}`
                }
                className="shell-command"
                type="button"
                onClick={onManageTranslation}
              >
                <span aria-hidden="true">中</span>
                <span>
                  {currentTranslationCount === null
                    ? "中文字幕"
                    : `中文字幕 · ${currentTranslationCount}`}
                </span>
              </button>
              <button
                className="shell-icon-command"
                type="button"
                title="修正字幕"
                aria-label="修正字幕"
                disabled={!canReviseSubtitles}
                onClick={onReviseSubtitles}
              >
                ✎
              </button>
              <button
                className="shell-icon-command"
                type="button"
                title="导出字幕与视频"
                aria-label="导出字幕与视频"
                disabled={!canDeliverSubtitles}
                onClick={onDeliverSubtitles}
              >
                ⇩
              </button>
              <span className="shell-command-divider" aria-hidden="true" />
              {(
                [
                  ["episodes", "剧集"],
                  ["understand", "理解"],
                  ["learn", "学习"],
                ] as const
              ).map(([tab, label]) => (
                <button
                  aria-pressed={drawerTab === tab}
                  className={`shell-drawer-command ${tab} ${
                    drawerTab === tab ? "active" : ""
                  }`}
                  key={tab}
                  type="button"
                  onClick={() => onToggleDrawer(tab)}
                >
                  {label}
                </button>
              ))}
            </>
          ) : null}
        </div>
        <div className="desktop-commandbar-status">
          {mediaTitle ? <strong title={mediaTitle}>{mediaTitle}</strong> : null}
          <span
            className={`status-pill ${runtimeStatus?.available ? "ready" : "warning"}`}
          >
            {runtimeLabel}
          </span>
          <span className="version-label">
            {appStatus ? `v${appStatus.version}` : "正在连接"}
          </span>
        </div>
      </header>

      <div className="desktop-workspace">
        <aside
          className={`desktop-navigation ${navigationCollapsed ? "collapsed" : ""}`}
          aria-label="媒体库导航"
        >
          <div className="desktop-navigation-brand">
            <span className="brand-mark" aria-hidden="true">V</span>
            <strong>SiaoVPlay</strong>
          </div>
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
              <span aria-hidden="true">▱</span>
              <span className="desktop-navigation-label">文件夹</span>
            </button>
            <button
              aria-label="媒体库：未归类视频"
              type="button"
              title="未归类视频"
              onClick={onGoLibrary}
            >
              <span aria-hidden="true">◫</span>
              <span className="desktop-navigation-label">未归类</span>
            </button>
          </nav>
          <p className="desktop-navigation-note">
            文件夹与剧集导入将在后续阶段启用。
          </p>
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
