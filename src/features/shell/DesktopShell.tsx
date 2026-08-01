import { useEffect, useRef, type ReactNode } from "react";

import type {
  AppStatus,
  LibrarySearchResult,
  MediaRuntimeStatus,
} from "../../types";
import type { LibrarySection } from "../library/useLibraryController";
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
  libraryCounts: {
    continueWatching: number;
    episodeFiles: number;
    series: number | null;
    folders: number | null;
    watchLater: number | null;
    unclassified: number;
  };
  librarySection: LibrarySection;
  searchQuery: string;
  searchResults: LibrarySearchResult[];
  searchLoading: boolean;
  onToggleNavigation: () => void;
  onToggleDrawer: (tab: ShellDrawerTab) => void;
  onGoLibrary: () => void;
  onSelectLibrarySection: (section: LibrarySection) => void;
  onSearchQueryChange: (query: string) => void;
  onOpenSearchResult: (result: LibrarySearchResult) => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
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
  libraryCounts,
  librarySection,
  searchQuery,
  searchResults,
  searchLoading,
  onToggleNavigation,
  onToggleDrawer,
  onGoLibrary,
  onSelectLibrarySection,
  onSearchQueryChange,
  onOpenSearchResult,
  onOpenFile,
  onOpenFolder,
  onOpenUrl,
  onManageSubtitles,
  onManageTranslation,
  onReviseSubtitles,
  onDeliverSubtitles,
  children,
}: DesktopShellProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const playerActive = activeView === "player";
  const runtimeLabel = previewMode
    ? "浏览器预览"
    : runtimeStatus?.available
      ? "本地媒体工具可用"
      : "正在检查媒体工具";

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

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
          <button
            aria-label="打开剧集文件夹"
            aria-keyshortcuts="Control+Shift+O"
            className="shell-command shell-command-primary"
            type="button"
            title="打开文件夹 Ctrl+Shift+O"
            onClick={onOpenFolder}
          >
            <span aria-hidden="true">▰</span>
            <span>打开文件夹</span>
          </button>
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
          <span className="shell-command-divider" aria-hidden="true" />
          {playerActive ? (
            <>
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
          ) : (
            <>
              <button
                aria-label="字幕，需要打开视频后使用"
                className="shell-command shell-context-unavailable"
                type="button"
                title="打开视频后管理字幕"
                disabled
              >
                <span aria-hidden="true">CC</span>
                <span>字幕</span>
              </button>
              <button
                aria-label="更多命令，需要打开视频后使用"
                className="shell-icon-command shell-context-unavailable"
                type="button"
                title="打开视频后使用更多字幕与交付命令"
                disabled
              >
                •••
              </button>
            </>
          )}
        </div>
        {playerActive && drawerTab ? (
          <div className="desktop-commandbar-context" title={mediaTitle ?? undefined}>
            {mediaTitle}
          </div>
        ) : null}
        <div className="desktop-commandbar-secondary">
          <div className="shell-search-wrap">
            <label className="shell-search">
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchInputRef}
                aria-label="搜索媒体库"
                type="search"
                placeholder="搜索媒体库  Ctrl+K"
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
              />
            </label>
            {searchQuery.trim() ? (
              <div className="shell-search-results" role="listbox" aria-label="媒体库搜索结果">
                {searchLoading ? (
                  <span className="shell-search-message">正在搜索…</span>
                ) : searchResults.length > 0 ? (
                  searchResults.map((result, index) => (
                    <button
                      key={`${result.kind}-${result.collectionId ?? result.projectId}-${index}`}
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() => onOpenSearchResult(result)}
                    >
                      <strong>{result.title}</strong>
                      <small>{result.subtitle ?? "本地媒体"}</small>
                    </button>
                  ))
                ) : (
                  <span className="shell-search-message">没有匹配内容</span>
                )}
              </div>
            ) : null}
          </div>
          <button
            aria-label="设置，内容待定义"
            className="shell-icon-command shell-context-unavailable"
            type="button"
            title="设置内容待定义"
            disabled
          >
            ⚙
          </button>
        </div>
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
              className={activeView === "library" && librarySection === "home" ? "active" : ""}
              type="button"
              title="继续观看"
              onClick={() => onSelectLibrarySection("home")}
            >
              <span aria-hidden="true">▶</span>
              <span className="desktop-navigation-label">继续观看</span>
              <span className="desktop-navigation-count">
                {libraryCounts.continueWatching}
              </span>
            </button>
            <button
              aria-label="媒体库：剧集"
              type="button"
              title="剧集与合集"
              className={activeView === "library" && librarySection === "series" ? "active" : ""}
              onClick={() => onSelectLibrarySection("series")}
            >
              <span aria-hidden="true">▦</span>
              <span className="desktop-navigation-label">剧集</span>
              {libraryCounts.series === null ? null : (
                <span className="desktop-navigation-count">{libraryCounts.series}</span>
              )}
            </button>
            <button
              aria-label="媒体库：文件夹"
              type="button"
              title="授权文件夹"
              className={activeView === "library" && librarySection === "folders" ? "active" : ""}
              onClick={() => onSelectLibrarySection("folders")}
            >
              <span aria-hidden="true">▰</span>
              <span className="desktop-navigation-label">文件夹</span>
              {libraryCounts.folders === null ? null : (
                <span className="desktop-navigation-count">{libraryCounts.folders}</span>
              )}
            </button>
            <button
              aria-label="媒体库：稍后观看"
              type="button"
              title="稍后观看"
              className={activeView === "library" && librarySection === "watch_later" ? "active" : ""}
              onClick={() => onSelectLibrarySection("watch_later")}
            >
              <span aria-hidden="true">◷</span>
              <span className="desktop-navigation-label">稍后观看</span>
              {libraryCounts.watchLater === null ? null : (
                <span className="desktop-navigation-count">
                  {libraryCounts.watchLater}
                </span>
              )}
            </button>
            <button
              aria-label="媒体库：未归类视频"
              type="button"
              title="未归类视频"
              className={activeView === "library" && librarySection === "unclassified" ? "active" : ""}
              onClick={() => onSelectLibrarySection("unclassified")}
            >
              <span aria-hidden="true">▸</span>
              <span className="desktop-navigation-label">未归类</span>
              <span className="desktop-navigation-count">
                {libraryCounts.unclassified}
              </span>
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
              已授权 {libraryCounts.folders ?? 0} 个本地文件夹。
              {appStatus ? ` · v${appStatus.version}` : ""}
            </span>
          </div>
        </aside>
        <section className="desktop-content" aria-label="当前内容">
          {children}
        </section>
      </div>
      <footer className="desktop-statusbar" aria-label="媒体库状态">
        <div>
          <span>
            {playerActive
              ? currentSubtitleCount === null
                ? "字幕未准备"
                : currentTranslationCount === null
                  ? "原文字幕已就绪"
                  : "原文字幕与简体中文翻译已就绪"
              : "媒体库就绪"}
          </span>
          <span>本地优先 · 不上传视频</span>
        </div>
        <div>
          <span>{libraryCounts.episodeFiles} 个剧集文件</span>
          <span>{libraryCounts.folders ?? 0} 个授权文件夹</span>
        </div>
      </footer>
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
