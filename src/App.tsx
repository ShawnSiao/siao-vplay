import { useCallback, useEffect, useRef, useState } from "react";

import { Dialog } from "./components/Dialog";
import { LibraryScreen } from "./components/LibraryScreen";
import { PlayerScreen } from "./components/PlayerScreen";
import { PreparationScreen } from "./components/PreparationScreen";
import { RemoteUrlDialog } from "./components/RemoteUrlDialog";
import { SubtitleImportDialog } from "./components/SubtitleImportDialog";
import { SubtitleDeliveryDialog } from "./components/SubtitleDeliveryDialog";
import { SubtitleRevisionDialog } from "./components/SubtitleRevisionDialog";
import { TranslationDialog } from "./components/TranslationDialog";
import {
  chooseLocalVideo,
  commandError,
  createLocalProject,
  deleteProject,
  ensureProjectPoster,
  getAppStatus,
  getProject,
  getMediaRuntimeStatus,
  isDesktopApp,
  listProjects,
  listSubtitleVersions,
  markProjectOpened,
  prepareProjectMedia,
  reconcileExternalAgentResults,
  relinkProjectMedia,
  updatePlaybackState,
} from "./lib/desktop";
import type {
  AppStatus,
  MediaPreparation,
  MediaRuntimeStatus,
  Project,
  SubtitleVersion,
  TranslationTask,
} from "./types";

type Screen = "library" | "preparing" | "player";

export default function App() {
  const operationTokenRef = useRef(0);
  const startupMediaHandledRef = useRef(false);
  const posterJobsRef = useRef(new Set<string>());
  const externalResultScanRef = useRef(false);
  const [screen, setScreen] = useState<Screen>("library");
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [runtimeStatus, setRuntimeStatus] =
    useState<MediaRuntimeStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [preparation, setPreparation] =
    useState<MediaPreparation | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(
    null,
  );
  const [forceProxy, setForceProxy] = useState(false);
  const [subtitleVersions, setSubtitleVersions] = useState<SubtitleVersion[]>(
    [],
  );
  const [subtitleDialogOpen, setSubtitleDialogOpen] = useState(false);
  const [translationDialogOpen, setTranslationDialogOpen] = useState(false);
  const [translationSegmentIds, setTranslationSegmentIds] = useState<
    string[] | undefined
  >(undefined);
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [remoteUrlDialogOpen, setRemoteUrlDialogOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Project | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      setLibraryError(null);
    } catch (error) {
      setLibraryError(commandError(error).message);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getAppStatus()
      .then((status) => {
        if (active) {
          setAppStatus(status);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLibraryError(commandError(error).message);
        }
      });
    void getMediaRuntimeStatus()
      .then((status) => {
        if (active) {
          setRuntimeStatus(status);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLibraryError(commandError(error).message);
        }
      });
    void listProjects()
      .then((nextProjects) => {
        if (active) {
          setProjects(nextProjects);
          setLibraryError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLibraryError(commandError(error).message);
        }
      })
      .finally(() => {
        if (active) {
          setLibraryLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isDesktopApp) {
      return;
    }
    for (const project of projects) {
      if (
        project.status !== "ready" ||
        project.mediaSource.posterPath ||
        posterJobsRef.current.has(project.id)
      ) {
        continue;
      }
      posterJobsRef.current.add(project.id);
      void ensureProjectPoster(project.id)
        .then((updated) => {
          setProjects((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          );
          setActiveProject((current) =>
            current?.id === updated.id ? updated : current,
          );
        })
        .catch(() => undefined)
        .finally(() => {
          posterJobsRef.current.delete(project.id);
        });
    }
  }, [projects]);

  const prepareAndOpen = useCallback(
    async (project: Project, shouldForceProxy: boolean) => {
      const token = operationTokenRef.current + 1;
      operationTokenRef.current = token;
      setActiveProject(project);
      setPreparation(null);
      setPreparationError(null);
      setForceProxy(shouldForceProxy);
      const preparationTimer = window.setTimeout(() => {
        if (operationTokenRef.current === token) {
          setScreen("preparing");
        }
      }, 240);
      try {
        const openedProject = shouldForceProxy
          ? project
          : await markProjectOpened(project.id);
        const result = await prepareProjectMedia(
          openedProject.id,
          shouldForceProxy,
        );
        if (operationTokenRef.current !== token) {
          window.clearTimeout(preparationTimer);
          return;
        }
        window.clearTimeout(preparationTimer);
        setActiveProject(openedProject);
        setPreparation(result);
        setScreen("player");
        void listSubtitleVersions(openedProject.id)
          .then((versions) => {
            if (operationTokenRef.current === token) {
              setSubtitleVersions(versions);
            }
          })
          .catch((error: unknown) => {
            if (operationTokenRef.current === token) {
              setToast(commandError(error).message);
            }
          });
        void refreshProjects();
      } catch (error) {
        if (operationTokenRef.current !== token) {
          window.clearTimeout(preparationTimer);
          return;
        }
        window.clearTimeout(preparationTimer);
        setScreen("preparing");
        setPreparationError(commandError(error).message);
      }
    },
    [refreshProjects],
  );

  const returnToLibrary = useCallback(() => {
    operationTokenRef.current += 1;
    setScreen("library");
    setPreparation(null);
    setPreparationError(null);
    setForceProxy(false);
    setSubtitleVersions([]);
    setSubtitleDialogOpen(false);
    setTranslationDialogOpen(false);
    setTranslationSegmentIds(undefined);
    setRevisionDialogOpen(false);
    setRemoteUrlDialogOpen(false);
    void refreshProjects();
  }, [refreshProjects]);

  const importMediaPath = useCallback(
    async (mediaPath: string) => {
      try {
        const existingProject = projects.find(
          (project) =>
            project.mediaSource.locator.toLocaleLowerCase() ===
            mediaPath.toLocaleLowerCase(),
        );
        setBusyMessage(
          existingProject
            ? "正在打开已有项目…"
            : "正在建立本地项目…",
        );
        const project =
          existingProject ?? (await createLocalProject(mediaPath));
        setBusyMessage(null);
        await prepareAndOpen(project, false);
      } catch (error) {
        setBusyMessage(null);
        setLibraryError(commandError(error).message);
      }
    },
    [prepareAndOpen, projects],
  );

  const importLocalVideo = useCallback(async () => {
    if (!isDesktopApp) {
      setToast("浏览器预览不会读取本地文件，请在桌面应用中体验导入。");
      return;
    }
    try {
      const mediaPath = await chooseLocalVideo();
      if (!mediaPath) {
        return;
      }
      await importMediaPath(mediaPath);
    } catch (error) {
      setBusyMessage(null);
      setLibraryError(commandError(error).message);
    }
  }, [importMediaPath]);

  const openRemoteUrlImport = useCallback(() => {
    setLibraryError(null);
    setRemoteUrlDialogOpen(true);
  }, []);

  useEffect(() => {
    const startupMediaPath = appStatus?.startupMediaPath;
    if (
      !isDesktopApp ||
      !startupMediaPath ||
      libraryLoading ||
      startupMediaHandledRef.current
    ) {
      return;
    }
    startupMediaHandledRef.current = true;
    void importMediaPath(startupMediaPath);
  }, [appStatus, importMediaPath, libraryLoading]);

  useEffect(() => {
    const handleOpenShortcut = (event: KeyboardEvent) => {
      if (
        screen === "library" &&
        event.ctrlKey &&
        event.key.toLowerCase() === "o" &&
        !deleteCandidate &&
        !busyMessage
      ) {
        event.preventDefault();
        void importLocalVideo();
      }
    };
    window.addEventListener("keydown", handleOpenShortcut);
    return () => window.removeEventListener("keydown", handleOpenShortcut);
  }, [busyMessage, deleteCandidate, importLocalVideo, screen]);

  const relinkProject = async (project: Project) => {
    try {
      const mediaPath = await chooseLocalVideo();
      if (!mediaPath) {
        return;
      }
      setBusyMessage("正在重新关联媒体…");
      const relinked = await relinkProjectMedia(project.id, mediaPath);
      setBusyMessage(null);
      await prepareAndOpen(relinked, false);
    } catch (error) {
      setBusyMessage(null);
      setLibraryError(commandError(error).message);
    }
  };

  const confirmDeleteProject = async () => {
    const project = deleteCandidate;
    if (!project) {
      return;
    }
    setBusyMessage("正在删除项目记录…");
    try {
      const result = await deleteProject(project.id);
      setDeleteCandidate(null);
      setBusyMessage(null);
      if (result.deleted && !result.sourceMediaDeleted) {
        setToast(
          project.mediaSource.originUrl
            ? result.cachedMediaDeleted
              ? "项目和本地副本已删除，远程来源未被修改。"
              : "项目已删除，远程来源未被修改。"
            : "项目已删除，源视频保持不变。",
        );
      }
      await refreshProjects();
    } catch (error) {
      setBusyMessage(null);
      setDeleteCandidate(null);
      setLibraryError(commandError(error).message);
    }
  };

  const persistPlayback = useCallback(
    async (values: {
      positionMs: number;
      durationMs: number | null;
      volume: number;
      playbackRate: number;
      subtitleMode: "original" | "translation" | "bilingual";
    }) => {
      if (!activeProject) {
        return;
      }
      const updated = await updatePlaybackState(activeProject.id, values);
      setActiveProject(updated);
      setProjects((current) =>
        current.map((project) =>
          project.id === updated.id ? updated : project,
        ),
      );
    },
    [activeProject],
  );

  const mergeSubtitleVersion = useCallback((version: SubtitleVersion) => {
    setSubtitleVersions((current) => [
      version,
      ...current
        .filter((item) => item.id !== version.id)
        .map((item) =>
          item.trackId === version.trackId
            ? { ...item, isCurrent: false }
            : item,
        ),
    ]);
  }, []);

  const handleTranslationCompleted = useCallback(
    async (task: TranslationTask, version?: SubtitleVersion) => {
      if (version) {
        mergeSubtitleVersion(version);
      } else {
        const versions = await listSubtitleVersions(task.projectId);
        setSubtitleVersions(versions);
      }
      setToast(
        task.validation?.warningCount
          ? `中文字幕草稿已生成，另有 ${task.validation.warningCount} 项一致性提示。`
          : `已生成 ${task.segmentCount} 条简体中文字幕草稿，可以开始抽查。`,
      );
      const updatedProject = await getProject(task.projectId);
      setActiveProject(updatedProject);
      setProjects((current) =>
        current.map((project) =>
          project.id === updatedProject.id ? updatedProject : project,
        ),
      );
      void refreshProjects();
    },
    [mergeSubtitleVersion, refreshProjects],
  );
  const activeProjectId = activeProject?.id;

  useEffect(() => {
    if (!isDesktopApp) {
      return undefined;
    }
    let active = true;
    const reconcile = async () => {
      if (externalResultScanRef.current) {
        return;
      }
      externalResultScanRef.current = true;
      try {
        const updates = await reconcileExternalAgentResults();
        if (!active || !updates.length) {
          return;
        }
        const latest = updates.at(-1);
        if (latest) {
          setToast(
            latest.status === "rejected"
              ? `外部 Agent 返回未通过检查：${latest.message}`
              : latest.message,
          );
        }
        if (
          updates.some(
            (update) =>
              update.status === "completed" &&
              update.taskKind === "translation" &&
              update.projectId === activeProjectId,
          ) &&
          activeProjectId
        ) {
          const [versions, updatedProject] = await Promise.all([
            listSubtitleVersions(activeProjectId),
            getProject(activeProjectId),
          ]);
          if (active) {
            setSubtitleVersions(versions);
            setActiveProject(updatedProject);
            setProjects((current) =>
              current.map((project) =>
                project.id === updatedProject.id ? updatedProject : project,
              ),
            );
          }
        }
      } catch {
        // 自动检测是后台增强能力；显式导入入口仍可继续使用。
      } finally {
        externalResultScanRef.current = false;
      }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeProjectId]);

  const handleSubtitleVersionCreated = useCallback(
    async (version: SubtitleVersion, message: string) => {
      mergeSubtitleVersion(version);
      const updatedProject = await getProject(version.projectId);
      setActiveProject(updatedProject);
      setProjects((current) =>
        current.map((project) =>
          project.id === updatedProject.id ? updatedProject : project,
        ),
      );
      setToast(message);
      void refreshProjects();
    },
    [mergeSubtitleVersion, refreshProjects],
  );

  return (
    <div className="app-shell">
      {screen === "library" ? (
        <LibraryScreen
          appStatus={appStatus}
          runtimeStatus={runtimeStatus}
          projects={projects}
          loading={libraryLoading}
          error={libraryError}
          previewMode={!isDesktopApp}
          onImport={() => void importLocalVideo()}
          onImportUrl={openRemoteUrlImport}
          onOpen={(project) => void prepareAndOpen(project, false)}
          onRelink={(project) => void relinkProject(project)}
          onDelete={setDeleteCandidate}
        />
      ) : null}

      {screen === "preparing" && activeProject ? (
        <PreparationScreen
          project={activeProject}
          forceProxy={forceProxy}
          error={preparationError}
          onRetry={() => void prepareAndOpen(activeProject, forceProxy)}
          onBack={returnToLibrary}
        />
      ) : null}

      {screen === "player" && activeProject && preparation ? (
        <PlayerScreen
          key={preparation.playbackPath}
          project={activeProject}
          preparation={preparation}
          currentSubtitle={
            subtitleVersions.find(
              (version) => version.role === "original" && version.isCurrent,
            ) ?? null
          }
          currentTranslation={
            subtitleVersions.find(
              (version) =>
                version.role === "translation" && version.isCurrent,
            ) ?? null
          }
          onBack={returnToLibrary}
          onManageSubtitles={() => setSubtitleDialogOpen(true)}
          onManageTranslation={() => {
            setTranslationSegmentIds(undefined);
            setTranslationDialogOpen(true);
          }}
          onReviseSubtitles={() => setRevisionDialogOpen(true)}
          onDeliverSubtitles={() => setDeliveryDialogOpen(true)}
          onNeedProxy={() => void prepareAndOpen(activeProject, true)}
          onPersist={persistPlayback}
          onError={(message) => {
            setPreparationError(message);
            setForceProxy(true);
            setScreen("preparing");
          }}
        />
      ) : null}

      {subtitleDialogOpen && activeProject && preparation ? (
        <SubtitleImportDialog
          projectId={activeProject.id}
          streams={preparation.inspection.probe.subtitleStreams}
          currentVersion={
            subtitleVersions.find(
              (version) => version.role === "original" && version.isCurrent,
            ) ?? null
          }
          onClose={() => setSubtitleDialogOpen(false)}
          onImported={(version) => {
            void handleSubtitleVersionCreated(
              version,
              version.sourceKind === "transcription"
                ? `已生成 ${version.segments.length} 条原文字幕草稿，可以开始抽查。`
                : `已导入 ${version.segments.length} 条原文字幕，保存为版本 ${version.versionNumber}。`,
            );
          }}
        />
      ) : null}

      {translationDialogOpen && activeProject ? (
        <TranslationDialog
          projectId={activeProject.id}
          sourceVersion={
            subtitleVersions.find(
              (version) => version.role === "original" && version.isCurrent,
            ) ?? null
          }
          translationVersion={
            subtitleVersions.find(
              (version) =>
                version.role === "translation" && version.isCurrent,
            ) ?? null
          }
          requestedSegmentIds={translationSegmentIds}
          onClose={() => {
            setTranslationDialogOpen(false);
            setTranslationSegmentIds(undefined);
          }}
          onPrepareOriginal={() => {
            setTranslationDialogOpen(false);
            setSubtitleDialogOpen(true);
          }}
          onTaskCompleted={handleTranslationCompleted}
        />
      ) : null}

      {revisionDialogOpen && activeProject ? (
        <SubtitleRevisionDialog
          project={activeProject}
          versions={subtitleVersions}
          onClose={() => setRevisionDialogOpen(false)}
          onVersionCreated={handleSubtitleVersionCreated}
          onRetranslate={(segmentIds) => {
            setRevisionDialogOpen(false);
            setTranslationSegmentIds(segmentIds);
            setTranslationDialogOpen(true);
          }}
        />
      ) : null}

      {deliveryDialogOpen && activeProject ? (
        <SubtitleDeliveryDialog
          project={activeProject}
          versions={subtitleVersions}
          currentSubtitle={
            subtitleVersions.find(
              (version) => version.role === "original" && version.isCurrent,
            ) ?? null
          }
          currentTranslation={
            subtitleVersions.find(
              (version) =>
                version.role === "translation" && version.isCurrent,
            ) ?? null
          }
          onClose={() => setDeliveryDialogOpen(false)}
        />
      ) : null}

      {remoteUrlDialogOpen ? (
        <RemoteUrlDialog
          previewMode={!isDesktopApp}
          onClose={() => setRemoteUrlDialogOpen(false)}
          onImported={(project) => {
            setRemoteUrlDialogOpen(false);
            setProjects((current) => [
              project,
              ...current.filter((item) => item.id !== project.id),
            ]);
            setToast("远程媒体已保存为本地副本。");
            void prepareAndOpen(project, false);
          }}
        />
      ) : null}

      {deleteCandidate ? (
        <Dialog
          title={
            deleteCandidate.mediaSource.originUrl
              ? "删除这个 URL 项目？"
              : "删除这个本地项目？"
          }
          eyebrow={
            deleteCandidate.mediaSource.originUrl
              ? "远程来源不会被修改"
              : "源视频不会被删除"
          }
          onClose={() => setDeleteCandidate(null)}
          actions={
            <>
              <button
                className="button quiet"
                type="button"
                onClick={() => setDeleteCandidate(null)}
              >
                取消
              </button>
              <button
                className="button danger"
                type="button"
                onClick={() => void confirmDeleteProject()}
              >
                删除项目
              </button>
            </>
          }
        >
          {deleteCandidate.mediaSource.originUrl ? (
            <p>
              「{deleteCandidate.title}
              」会从项目库移除，本机保存的受控媒体副本也会删除；远程来源不会被修改。
            </p>
          ) : (
            <p>
              「{deleteCandidate.title}
              」会从项目库移除。播放位置和项目记录会被删除，原视频文件不会被修改或删除。
            </p>
          )}
          <div className="source-file-note">
            <span>
              {deleteCandidate.mediaSource.originUrl ? "本地副本" : "源文件"}
            </span>
            <strong>{deleteCandidate.mediaSource.displayName}</strong>
          </div>
        </Dialog>
      ) : null}

      {busyMessage ? (
        <div className="busy-backdrop" role="status" aria-live="assertive">
          <div className="busy-card">
            <span className="spinner large"></span>
            <strong>{busyMessage}</strong>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
