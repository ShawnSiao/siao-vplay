import { useEffect, useRef, type ReactNode } from "react";

import { MenuPopover } from "../../components/MenuPopover";
import type {
  AppStatus,
  LibrarySearchResult,
  LocalResourceStatus,
} from "../../types";
import type { LibrarySection } from "../library/useLibraryController";
import type { MediaDropFeedback } from "./useDesktopMediaDrop";
import type { ShellDrawerTab, ShellView } from "./useShellController";
import { EnvironmentSettingsTrigger } from "./EnvironmentSettingsTrigger";
import { LibraryAddMediaActions } from "./LibraryAddMediaActions";
import "./PlayerCommandbar.css";

type DesktopShellProps = {
  activeView: ShellView;
  navigationCollapsed: boolean;
  drawerTab: ShellDrawerTab | null;
  dropFeedback: MediaDropFeedback | null;
  appStatus: AppStatus | null;
  localResourceStatus: LocalResourceStatus | null;
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
  onOpenSettings: () => void;
  children: ReactNode;
};

export function DesktopShell({
  activeView,
  navigationCollapsed,
  drawerTab,
  dropFeedback,
  appStatus,
  localResourceStatus,
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
  onOpenSettings,
  children,
}: DesktopShellProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const playerActive = activeView === "player";
  const readyCapabilityCount =
    localResourceStatus?.capabilities.filter(
      (capability) => capability.state === "ready",
    ).length ?? 0;
  const basicMediaReady = localResourceStatus?.capabilities.some(
    (capability) => capability.id === "basic_media" && capability.state === "ready",
  );
  const localResourceLabel = previewMode
    ? "浏览器预览"
    : localResourceStatus === null
      ? "正在检查本地功能"
      : readyCapabilityCount > 0
        ? `${readyCapabilityCount} 项本地功能已准备`
        : "本地功能按需准备";

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (playerActive) onGoLibrary();
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [onGoLibrary, playerActive]);

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
          {playerActive ? (
            <>
              <span className="desktop-commandbar-context" title={mediaTitle ?? undefined}>
                {mediaTitle}
              </span>
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
              <button
                aria-pressed={drawerTab === "understand"}
                className={`shell-drawer-command understand ${drawerTab === "understand" ? "active" : ""}`}
                type="button"
                onClick={() => onToggleDrawer("understand")}
              >
                理解
              </button>
              <button
                aria-pressed={drawerTab === "learn"}
                className={`shell-drawer-command learn ${drawerTab === "learn" ? "active" : ""}`}
                type="button"
                onClick={() => onToggleDrawer("learn")}
              >
                学习
              </button>
              <MenuPopover
                className="shell-overflow shell-player-more"
                label="更多"
                triggerClassName="shell-drawer-command"
                panelClassName="shell-overflow-menu shell-player-more-menu"
                trigger={<span>更多</span>}
              >
                  <button type="button" role="menuitem" onClick={() => onToggleDrawer("episodes")}>
                    <span>剧集</span>
                    <small>当前合集</small>
                  </button>
                  <button type="button" role="menuitem" onClick={() => onToggleDrawer("transcript")}>
                    <span>逐字稿</span>
                    <small>同步字幕</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onGoLibrary();
                      window.setTimeout(() => searchInputRef.current?.focus(), 0);
                    }}
                  >
                    <span>搜索媒体库</span>
                    <small>Ctrl+K</small>
                  </button>
                  <button type="button" role="menuitem" aria-keyshortcuts="Control+O" onClick={onOpenFile}>
                    <span>打开其他视频</span>
                    <small>Ctrl+O</small>
                  </button>
                  <button type="button" role="menuitem" aria-keyshortcuts="Control+Shift+O" onClick={onOpenFolder}>
                    <span>添加剧集文件夹</span>
                    <small>Ctrl+Shift+O</small>
                  </button>
                  <button type="button" role="menuitem" onClick={onOpenUrl}>
                    <span>从公开链接导入</span>
                    <small>HTTPS</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={onManageTranslation}
                  >
                    <span>中文字幕</span>
                    <small>{currentTranslationCount ?? "未生成"}</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canReviseSubtitles}
                    onClick={onReviseSubtitles}
                  >
                    <span>修正字幕</span>
                    <small>逐句与时间轴</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canDeliverSubtitles}
                    onClick={onDeliverSubtitles}
                  >
                    <span>导出字幕与视频</span>
                    <small>交付</small>
                  </button>
              </MenuPopover>
            </>
          ) : <LibraryAddMediaActions
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
            onOpenUrl={onOpenUrl}
          />}
        </div>
        {!playerActive ? <div className="desktop-commandbar-secondary">
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
        </div> : null}
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
              aria-label="媒体库：未分类视频"
              type="button"
              title="未分类视频"
              className={activeView === "library" && librarySection === "unclassified" ? "active" : ""}
              onClick={() => onSelectLibrarySection("unclassified")}
            >
              <span aria-hidden="true">▸</span>
              <span className="desktop-navigation-label">未分类</span>
              <span className="desktop-navigation-count">
                {libraryCounts.unclassified}
              </span>
            </button>
          </nav>
          <div className="desktop-navigation-bottom">
            <EnvironmentSettingsTrigger
              status={localResourceLabel}
              onOpen={onOpenSettings}
            />
            <div className="desktop-navigation-note">
              <strong>
                <span
                  className={`navigation-status-dot ${basicMediaReady ? "ready" : "warning"}`}
                  aria-hidden="true"
                />
                {localResourceLabel}
              </strong>
              <span>
                已授权 {libraryCounts.folders ?? 0} 个本地文件夹。
                {appStatus ? ` · v${appStatus.version}` : ""}
              </span>
            </div>
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
