import { useCallback, useEffect, useRef, useState } from "react";

import { Dialog } from "./components/Dialog";
import { LibraryScreen } from "./components/LibraryScreen";
import { PlayerScreen } from "./components/PlayerScreen";
import { PreparationScreen } from "./components/PreparationScreen";
import {
  chooseLocalVideo,
  commandError,
  createLocalProject,
  deleteProject,
  ensureProjectPoster,
  getAppStatus,
  getMediaRuntimeStatus,
  isDesktopApp,
  listProjects,
  markProjectOpened,
  prepareProjectMedia,
  relinkProjectMedia,
  updatePlaybackState,
} from "./lib/desktop";
import type {
  AppStatus,
  MediaPreparation,
  MediaRuntimeStatus,
  Project,
} from "./types";

type Screen = "library" | "preparing" | "player";

export default function App() {
  const operationTokenRef = useRef(0);
  const startupMediaHandledRef = useRef(false);
  const posterJobsRef = useRef(new Set<string>());
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
        setToast("项目已删除，源视频保持不变。");
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
          onBack={returnToLibrary}
          onNeedProxy={() => void prepareAndOpen(activeProject, true)}
          onPersist={persistPlayback}
          onError={(message) => {
            setPreparationError(message);
            setForceProxy(true);
            setScreen("preparing");
          }}
        />
      ) : null}

      {deleteCandidate ? (
        <Dialog
          title="删除这个本地项目？"
          eyebrow="源视频不会被删除"
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
          <p>
            「{deleteCandidate.title}
            」会从项目库移除。播放位置和项目记录会被删除，原视频文件不会被修改或删除。
          </p>
          <div className="source-file-note">
            <span>源文件</span>
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
