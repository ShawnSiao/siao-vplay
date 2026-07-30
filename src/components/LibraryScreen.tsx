import type { AppStatus, MediaRuntimeStatus, Project } from "../types";
import { playbackUrl } from "../lib/desktop";
import {
  fileExtension,
  formatDuration,
  formatRecentTime,
} from "../lib/format";

type LibraryScreenProps = {
  appStatus: AppStatus | null;
  runtimeStatus: MediaRuntimeStatus | null;
  projects: Project[];
  loading: boolean;
  error: string | null;
  previewMode: boolean;
  onImport: () => void;
  onOpen: (project: Project) => void;
  onRelink: (project: Project) => void;
  onDelete: (project: Project) => void;
};

function ProjectCard({
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
  const posterPath = project.mediaSource.posterPath;
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
    <article className="project-card">
      <button
        className={`project-poster ${posterPath ? "poster-has-image" : ""}`}
        type="button"
        onClick={() => (needsRelink ? onRelink(project) : onOpen(project))}
        aria-label={`${needsRelink ? "重新定位" : "打开"} ${project.title}`}
      >
        {posterPath ? (
          <img
            className="poster-image"
            src={playbackUrl(posterPath)}
            alt=""
          />
        ) : (
          <span className="poster-extension">
            {fileExtension(project.mediaSource.displayName)}
          </span>
        )}
        <span className="poster-status">
          {needsRelink ? "媒体文件已移动" : "本地视频"}
        </span>
        <span className="poster-duration">
          {formatDuration(project.playbackState.durationMs)}
        </span>
      </button>
      <div className="project-card-body">
        <div className="project-card-heading">
          <div>
            <h3>{project.title}</h3>
            <p title={project.mediaSource.displayName}>
              {project.mediaSource.displayName}
            </p>
          </div>
          <span className={`status-pill ${needsRelink ? "warning" : "ready"}`}>
            {needsRelink ? "需要重新定位" : "可以观看"}
          </span>
        </div>
        <div className="watch-progress" aria-label={`观看进度 ${progress}%`}>
          <span style={{ width: `${progress}%` }}></span>
        </div>
        <footer className="project-card-footer">
          <span>
            {project.playbackState.positionMs > 0
              ? `看到 ${formatDuration(project.playbackState.positionMs)}`
              : `${formatRecentTime(project.lastOpenedAtMs)} 打开`}
          </span>
          <div className="card-actions">
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
              {needsRelink
                ? "重新定位"
                : project.playbackState.positionMs > 0
                  ? "继续观看"
                  : "开始观看"}
            </button>
          </div>
        </footer>
      </div>
    </article>
  );
}

export function LibraryScreen({
  appStatus,
  runtimeStatus,
  projects,
  loading,
  error,
  previewMode,
  onImport,
  onOpen,
  onRelink,
  onDelete,
}: LibraryScreenProps) {
  return (
    <div className="library-screen" data-screen-label="本地项目库">
      <header className="titlebar">
        <div className="brand-lockup" aria-label="SiaoVPlay">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span className="brand-name">SiaoVPlay</span>
        </div>
        <div className="titlebar-status">
          {previewMode ? (
            <span className="status-pill warning">浏览器界面预览</span>
          ) : (
            <span
              className={`status-pill ${
                runtimeStatus?.available ? "ready" : "warning"
              }`}
            >
              {runtimeStatus?.available
                ? "本地媒体工具可用"
                : "正在检查媒体工具"}
            </span>
          )}
          <span className="version-label">
            {appStatus ? `v${appStatus.version}` : "正在连接"}
          </span>
        </div>
      </header>

      <main className="library-content">
        <header className="library-header">
          <div>
            <p className="eyebrow">本地优先的跨语言播放器</p>
            <h1>专注观看，需要时再理解。</h1>
            <p className="lead">
              从本地视频开始建立观影项目。播放位置保存在本机，源文件始终由自己掌控。
            </p>
          </div>
          <button
            aria-keyshortcuts="Control+O"
            autoFocus={projects.length === 0}
            className="button primary import-button"
            type="button"
            onClick={onImport}
          >
            导入本地视频
          </button>
        </header>

        <section className="import-strip" aria-label="本地导入说明">
          <div>
            <span className="step-number">01</span>
            <span>
              <strong>选择本地视频</strong>
              <small>支持 MP4、MKV、MOV、WebM 等常见格式。</small>
            </span>
          </div>
          <div>
            <span className="step-number">02</span>
            <span>
              <strong>自动检查播放能力</strong>
              <small>不兼容的编码会生成独立播放版本，不改动原片。</small>
            </span>
          </div>
          <div>
            <span className="step-number">03</span>
            <span>
              <strong>从上次位置继续</strong>
              <small>项目、播放位置和媒体关系可在重启后恢复。</small>
            </span>
          </div>
        </section>

        <section className="project-section" aria-labelledby="projects-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">最近观看</p>
              <h2 id="projects-title">本地项目</h2>
            </div>
            <span>{projects.length} 个项目</span>
          </div>

          {error ? (
            <div className="notice danger" role="alert">
              <strong>项目库暂时无法读取</strong>
              <p>{error}</p>
            </div>
          ) : null}

          {loading ? (
            <div className="project-loading" aria-live="polite">
              <span className="spinner"></span>
              <span>正在读取本地项目…</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-library">
              <div className="empty-glyph" aria-hidden="true">
                ▶
              </div>
              <h3>{previewMode ? "桌面应用会在这里显示真实项目" : "还没有本地项目"}</h3>
              <p>
                {previewMode
                  ? "当前页面只用于检查界面，不会读取浏览器中的本地文件。"
                  : "导入一段拥有处理权利的视频，SiaoVPlay 会先检查是否可以稳定播放。"}
              </p>
              <button
                aria-keyshortcuts="Control+O"
                className="button primary"
                type="button"
                onClick={onImport}
              >
                选择第一个视频
              </button>
            </div>
          ) : (
            <div className="project-grid">
              {projects.map((project) => (
                <ProjectCard
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
  );
}
