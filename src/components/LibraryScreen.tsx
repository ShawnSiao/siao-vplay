import type { Project } from "../types";
import { playbackUrl } from "../lib/desktop";
import {
  fileExtension,
  formatDuration,
  formatRecentTime,
} from "../lib/format";

type LibraryScreenProps = {
  projects: Project[];
  loading: boolean;
  error: string | null;
  previewMode: boolean;
  onImport: () => void;
  onImportUrl: () => void;
  onOpen: (project: Project) => void;
  onRelink: (project: Project) => void;
  onDelete: (project: Project) => void;
};

function projectLocation(project: Project): string {
  if (project.mediaSource.originUrl) {
    return project.mediaSource.originUrl;
  }
  const locator = project.mediaSource.locator;
  const separatorIndex = Math.max(locator.lastIndexOf("\\"), locator.lastIndexOf("/"));
  return separatorIndex > 0 ? locator.slice(0, separatorIndex) : "本地文件";
}

function LibraryItemRow({
  project,
  onOpen,
  onRelink,
  onDelete,
}: {
  project: Project;
  onOpen: (project: Project) => void;
  onRelink: (project: Project) => void;
  onDelete: (project: Project) => void;
}) {
  const needsRelink = project.status === "needs_relink";
  const progress =
    project.playbackState.durationMs && project.playbackState.durationMs > 0
      ? Math.round(
          Math.max(
            0,
            Math.min(
              100,
              (project.playbackState.positionMs /
                project.playbackState.durationMs) *
                100,
            ),
          ),
        )
      : 0;

  return (
    <article className="library-item-row">
      <button
        className="library-item-open"
        type="button"
        onClick={() => (needsRelink ? onRelink(project) : onOpen(project))}
        aria-label={`${needsRelink ? "重新定位" : "打开"} ${project.title}`}
      >
        <span className="library-file-kind">
          {fileExtension(project.mediaSource.displayName)}
        </span>
        <span className="library-item-title">
          <strong>{project.title}</strong>
          <small title={project.mediaSource.displayName}>
            {project.mediaSource.displayName}
          </small>
        </span>
      </button>
      <div className="library-item-progress">
        <div className="watch-progress" aria-label={`观看进度 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <span>
          {project.playbackState.positionMs > 0
            ? `看到 ${formatDuration(project.playbackState.positionMs)}`
            : "未观看"}
        </span>
      </div>
      <span className={`library-item-status ${needsRelink ? "warning" : "ready"}`}>
        {needsRelink ? "需要重新定位" : "可以观看"}
      </span>
      <span className="library-item-recent">
        {formatRecentTime(project.lastOpenedAtMs)}
      </span>
      <div className="library-item-actions">
        <button
          className="button quiet small"
          type="button"
          onClick={() => onDelete(project)}
        >
          删除
        </button>
        <button
          className={`button small ${needsRelink ? "" : "primary"}`}
          type="button"
          onClick={() => (needsRelink ? onRelink(project) : onOpen(project))}
        >
          {needsRelink ? "重新定位" : project.playbackState.positionMs > 0 ? "继续" : "播放"}
        </button>
      </div>
    </article>
  );
}

function ContinueWatchingItem({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: (project: Project) => void;
}) {
  const posterPath = project.mediaSource.posterPath;
  const durationMs = project.playbackState.durationMs ?? 0;
  const progress =
    durationMs > 0
      ? Math.round(
          Math.max(
            0,
            Math.min(100, (project.playbackState.positionMs / durationMs) * 100),
          ),
        )
      : 0;

  return (
    <button
      className="continue-item"
      type="button"
      aria-label={`继续播放 ${project.title}`}
      onClick={() => onOpen(project)}
    >
      <span className="continue-thumbnail">
        {posterPath ? (
          <img className="poster-image" src={playbackUrl(posterPath)} alt="" />
        ) : (
          <span className="poster-extension">
            {fileExtension(project.mediaSource.displayName)}
          </span>
        )}
      </span>
      <span className="continue-item-copy">
        <small className="continue-kicker">继续观看</small>
        <strong>{project.title}</strong>
        <small>
          {project.mediaSource.displayName} · {formatDuration(project.playbackState.positionMs)}
          {durationMs > 0 ? ` / ${formatDuration(durationMs)}` : ""}
        </small>
        <small>
          上次观看于 {formatRecentTime(project.lastOpenedAtMs)}
        </small>
        <span
          className="watch-progress"
          aria-label={`继续观看进度 ${progress}%`}
        >
          <span style={{ width: `${progress}%` }} />
        </span>
      </span>
      <span className="continue-action">
        从 {formatDuration(project.playbackState.positionMs)} 继续
      </span>
    </button>
  );
}

function RecentlyAddedItem({
  project,
  onOpen,
  onRelink,
}: {
  project: Project;
  onOpen: (project: Project) => void;
  onRelink: (project: Project) => void;
}) {
  const needsRelink = project.status === "needs_relink";
  return (
    <button
      className="recently-added-row"
      type="button"
      aria-label={`${needsRelink ? "重新定位" : "打开"}最近加入的 ${project.title}`}
      onClick={() => (needsRelink ? onRelink(project) : onOpen(project))}
    >
      <span className="library-file-kind">
        {fileExtension(project.mediaSource.displayName)}
      </span>
      <span className="recently-added-title">
        <strong>{project.title}</strong>
        <small title={projectLocation(project)}>{projectLocation(project)}</small>
      </span>
      <span className={`library-item-status ${needsRelink ? "warning" : "ready"}`}>
        {needsRelink ? "需要重新定位" : "可以观看"}
      </span>
      <span className="library-item-recent">
        {formatRecentTime(project.createdAtMs)}
      </span>
      <span className="recently-added-open" aria-hidden="true">›</span>
    </button>
  );
}

export function LibraryScreen({
  projects,
  loading,
  error,
  previewMode,
  onImport,
  onImportUrl,
  onOpen,
  onRelink,
  onDelete,
}: LibraryScreenProps) {
  const allContinueWatching = [...projects]
    .filter((project) => project.playbackState.positionMs > 0)
    .sort((left, right) => right.lastOpenedAtMs - left.lastOpenedAtMs);
  const continueWatching = allContinueWatching.slice(0, 4);
  const recentlyAdded = [...projects]
    .sort((left, right) => right.createdAtMs - left.createdAtMs)
    .slice(0, 5);
  const latestContinueProject = allContinueWatching[0] ?? null;

  return (
    <div className="library-screen" data-screen-label="媒体库">
      <div className="library-scroll">
        <main className="library-content">
          <header className="library-header">
            <div>
              <h1>媒体库</h1>
              <p>本地视频、观看进度和字幕资料都保存在当前设备。</p>
            </div>
            <div className="library-header-actions">
              <button
                aria-label="打开文件夹，将在 Phase 7D 启用"
                className="button unavailable"
                type="button"
                title="文件夹扫描将在 Phase 7D 启用"
                disabled
              >
                打开文件夹
              </button>
              {latestContinueProject ? (
                <button
                  className="button primary"
                  type="button"
                  aria-label={`打开最近观看的 ${latestContinueProject.title}`}
                  onClick={() => onOpen(latestContinueProject)}
                >
                  继续播放
                </button>
              ) : (
                <span className="library-count">{projects.length} 个视频</span>
              )}
            </div>
          </header>

          {continueWatching.length > 0 ? (
            <section
              className="project-section continue-section"
              aria-labelledby="continue-title"
            >
              <div className="section-heading">
                <h2 id="continue-title">继续观看</h2>
                <span>{allContinueWatching.length} 个播放中内容</span>
              </div>
              <div className="continue-grid">
                {continueWatching.map((project) => (
                  <ContinueWatchingItem
                    key={project.id}
                    project={project}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="project-section" aria-labelledby="series-title">
            <div className="section-heading">
              <h2 id="series-title">剧集</h2>
              <button
                className="section-link"
                type="button"
                title="剧集与合集将在 Phase 7C 启用"
                disabled
              >
                查看全部 ›
              </button>
            </div>
            <div className="library-series-empty">
              <strong>尚未建立剧集或合集</strong>
              <p>Phase 7C 接入真实集合数据后，这里会显示季、集数和观看进度。</p>
            </div>
          </section>

          {recentlyAdded.length > 0 ? (
            <section className="project-section" aria-labelledby="recent-title">
              <div className="section-heading">
                <div>
                  <h2 id="recent-title">最近加入</h2>
                  <p>单个视频保留在「未归类」</p>
                </div>
                <span>{recentlyAdded.length} 个最近项目</span>
              </div>
              <div className="recently-added-list">
                {recentlyAdded.map((project) => (
                  <RecentlyAddedItem
                    key={project.id}
                    project={project}
                    onOpen={onOpen}
                    onRelink={onRelink}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="project-section" aria-labelledby="projects-title">
            <div className="section-heading">
              <div>
                <h2 id="projects-title">未归类视频</h2>
                <p>剧集与合集功能接通前，现有视频统一显示在这里。</p>
              </div>
              <span>{projects.length} 个视频</span>
            </div>

            {error ? (
              <div className="notice danger" role="alert">
                <strong>媒体库暂时无法读取</strong>
                <p>{error}</p>
              </div>
            ) : null}

            {loading ? (
              <div className="project-loading" aria-live="polite">
                <span className="spinner"></span>
                <span>正在读取本地视频…</span>
              </div>
            ) : projects.length === 0 ? (
              <div className="empty-library">
                <div className="empty-glyph" aria-hidden="true">
                  ▶
                </div>
                <h3>
                  {previewMode ? "桌面应用会显示真实视频" : "还没有本地视频"}
                </h3>
                <p>
                  {previewMode
                    ? "当前页面只用于检查界面，不会读取浏览器中的本地文件。"
                    : "可从命令栏打开本地视频或公开媒体 URL。SiaoVPlay 不会修改源视频。"}
                </p>
                <div className="empty-library-actions">
                  <button
                    className="button"
                    type="button"
                    onClick={onImportUrl}
                  >
                    打开 URL
                  </button>
                  <button
                    aria-keyshortcuts="Control+O"
                    autoFocus
                    className="button primary"
                    type="button"
                    onClick={onImport}
                  >
                    打开视频
                  </button>
                </div>
              </div>
            ) : (
              <div className="library-item-list">
                {projects.map((project) => (
                  <LibraryItemRow
                    key={project.id}
                    project={project}
                    onOpen={onOpen}
                    onRelink={onRelink}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
