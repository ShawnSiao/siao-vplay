import { useCallback, useEffect, useRef, useState } from "react";

import { Dialog } from "./components/Dialog";
import { LibraryFolderImportDialog } from "./components/LibraryFolderImportDialog";
import { LibraryRecoveryDialog } from "./components/LibraryRecoveryDialog";
import { LibraryScreen } from "./components/LibraryScreen";
import { PlayerScreen } from "./features/playback/PlayerScreen";
import { useLibraryController } from "./features/library/useLibraryController";
import { openProjectMediaLocation } from "./features/library/libraryGateway";
import {
  useEpisodeNavigation,
  type EpisodePlaybackContext,
} from "./features/library/useEpisodeNavigation";
import { PreparationScreen } from "./components/PreparationScreen";
import { RemoteUrlDialog } from "./components/RemoteUrlDialog";
import { RuntimeSettingsDialog } from "./components/RuntimeSettingsDialog";
import { SubtitleImportDialog } from "./components/SubtitleImportDialog";
import { SubtitleDeliveryDialog } from "./components/SubtitleDeliveryDialog";
import { SubtitleRevisionDialog } from "./components/SubtitleRevisionDialog";
import { TranslationDialog } from "./components/TranslationDialog";
import { DesktopShell } from "./features/shell/DesktopShell";
import { useDesktopMediaDrop } from "./features/shell/useDesktopMediaDrop";
import { useShellController } from "./features/shell/useShellController";
import {
  chooseLocalFolder,
  chooseLocalVideo,
  commandError,
  createLocalProject,
  deleteProject,
  ensureProjectPoster,
  getAppStatus,
  getTranscriptionJob,
  getProject,
  getMediaRuntimeStatus,
  getComponentCatalogInfo,
  getComponentStoreRoot,
  listComponentInstallations,
  getRuntimeCatalog,
  isDesktopApp,
  listProjects,
  listSubtitleVersions,
  markProjectOpened,
  prepareProjectMedia,
  reconcileExternalAgentResults,
  relinkProjectMedia,
  setMainWindowMediaTitle,
  updatePlaybackState,
} from "./lib/desktop";
import type {
  AppStatus,
  MediaPreparation,
  MediaRuntimeStatus,
  Project,
  RuntimeCatalog,
  ComponentCatalogInfo,
  ComponentInstallationStatus,
  ComponentStoreRootInfo,
  SubtitleVersion,
  TranscriptionJob,
  TranslationTask,
  LibraryMediaSummary,
  LibrarySearchResult,
  EpisodeReference,
} from "./types";

const activeTranscriptionStatuses = new Set<TranscriptionJob["status"]>([
  "queued",
  "extracting",
  "transcribing",
  "validating",
]);

export default function App() {
  const shellController = useShellController();
  const {
    state: libraryState,
    refresh: refreshLibrary,
    setSection: setLibrarySection,
    setSearchQuery,
    openCollection,
    closeCollection,
    selectSeason,
    createManualCollection,
    editCollection,
    removeCollection,
    addToCollection,
    removeFromCollection,
    changeWatchLater,
    startFolderScan,
    cancelFolderScan,
    closeFolderImport,
    setFolderImportTitle,
    updateFolderImportItem,
    setConfirmFingerprintDuplicates,
    importScannedFolder,
    inspectRootRescan,
    inspectRootRebuild,
    inspectRootRelocation,
    closeRecovery,
    updateRecoveryItem,
    setRecoveryConfirmation,
    setRebuildCollectionTitle,
    applyRescan,
    applyRebuild,
    applyRootRelocation,
    revokeRoot,
  } = useLibraryController();
  const screen = shellController.state.activeView;
  const setScreen = shellController.setActiveView;
  const operationTokenRef = useRef(0);
  const startupMediaHandledRef = useRef(false);
  const posterJobsRef = useRef(new Set<string>());
  const externalResultScanRef = useRef(false);
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [runtimeStatus, setRuntimeStatus] =
    useState<MediaRuntimeStatus | null>(null);
  const [runtimeCatalog, setRuntimeCatalog] =
    useState<RuntimeCatalog | null>(null);
  const [runtimeCatalogLoading, setRuntimeCatalogLoading] = useState(false);
  const [sharedCatalog, setSharedCatalog] = useState<ComponentCatalogInfo | null>(null);
  const [sharedRoot, setSharedRoot] = useState<ComponentStoreRootInfo | null>(null);
  const [sharedInstallations, setSharedInstallations] = useState<ComponentInstallationStatus[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [episodeContext, setEpisodeContext] =
    useState<EpisodePlaybackContext | null>(null);
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
  const [trackedTranscriptionJobId, setTrackedTranscriptionJobId] = useState<
    string | null
  >(null);
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
  const [runtimeSettingsOpen, setRuntimeSettingsOpen] = useState(false);
  const episodeNavigation = useEpisodeNavigation(
    episodeContext,
    activeProject?.id ?? null,
  );

  const refreshRuntimeCatalog = useCallback(async () => {
    setRuntimeCatalogLoading(true);
    try {
      setRuntimeCatalog(await getRuntimeCatalog());
    } catch (error) {
      setToast(commandError(error).message);
    } finally {
      setRuntimeCatalogLoading(false);
    }
  }, []);

  const refreshSharedComponents = useCallback(async () => {
    try {
      const [info, root, installations] = await Promise.all([
        getComponentCatalogInfo(),
        getComponentStoreRoot(),
        listComponentInstallations(),
      ]);
      setSharedCatalog(info);
      setSharedRoot(root);
      setSharedInstallations(installations);
    } catch (error) {
      if (String(error).includes("getComponentCatalogInfo")) {
        return;
      }
      setToast(commandError(error).message);
    }
  }, []);

  const openRuntimeSettings = useCallback(() => {
    setRuntimeSettingsOpen(true);
    void refreshRuntimeCatalog();
    void refreshSharedComponents();
  }, [refreshRuntimeCatalog, refreshSharedComponents]);

  const handleRuntimeCatalogChange = useCallback((catalog: RuntimeCatalog) => {
    setRuntimeCatalog(catalog);
    void getMediaRuntimeStatus()
      .then(setRuntimeStatus)
      .catch((error: unknown) => setToast(commandError(error).message));
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      setLibraryError(null);
      await refreshLibrary();
    } catch (error) {
      setLibraryError(commandError(error).message);
    }
  }, [refreshLibrary]);

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
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const mediaTitle =
      screen === "library" ? null : (activeProject?.title ?? null);
    void setMainWindowMediaTitle(mediaTitle).catch((error: unknown) => {
      console.warn("Unable to update the native SiaoVPlay window title", error);
    });
  }, [activeProject?.title, screen]);

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
          void refreshLibrary();
        })
        .catch(() => undefined)
        .finally(() => {
          posterJobsRef.current.delete(project.id);
        });
    }
  }, [projects, refreshLibrary]);

  const prepareAndOpen = useCallback(
    async (
      project: Project,
      shouldForceProxy: boolean,
      nextEpisodeContext: EpisodePlaybackContext | null,
    ) => {
      const token = operationTokenRef.current + 1;
      operationTokenRef.current = token;
      setActiveProject(project);
      setPreparation(null);
      setPreparationError(null);
      setForceProxy(shouldForceProxy);
      if (!shouldForceProxy) {
        setEpisodeContext(nextEpisodeContext);
      }
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
    [refreshProjects, setScreen],
  );

  const returnToLibrary = useCallback(() => {
    operationTokenRef.current += 1;
    setLibrarySection("home");
    setScreen("library");
    setPreparation(null);
    setPreparationError(null);
    setForceProxy(false);
    setSubtitleVersions([]);
    setEpisodeContext(null);
    setSubtitleDialogOpen(false);
    setTranslationDialogOpen(false);
    setTranslationSegmentIds(undefined);
    setRevisionDialogOpen(false);
    setRemoteUrlDialogOpen(false);
    void refreshProjects();
  }, [refreshProjects, setLibrarySection, setScreen]);

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
        await prepareAndOpen(project, false, null);
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

  const importLocalFolder = useCallback(async () => {
    if (!isDesktopApp) {
      setToast("浏览器预览不会读取本地文件夹，请在桌面应用中体验剧集导入。");
      return;
    }
    try {
      const rootPath = await chooseLocalFolder();
      if (!rootPath) {
        return;
      }
      setLibraryError(null);
      await startFolderScan(rootPath);
    } catch (error) {
      setLibraryError(commandError(error).message);
    }
  }, [startFolderScan]);

  const relocateLibraryRoot = useCallback(
    async (rootId: string) => {
      if (!isDesktopApp) {
        setToast("浏览器预览不会读取本地文件夹，请在桌面应用中检查根目录。");
        return;
      }
      try {
        const newRootPath = await chooseLocalFolder();
        if (!newRootPath) {
          return;
        }
        await inspectRootRelocation(rootId, newRootPath);
      } catch (error) {
        setLibraryError(commandError(error).message);
      }
    },
    [inspectRootRelocation],
  );

  const rebuildLibraryRoot = useCallback(
    async (rootId: string, needsNewLocation: boolean) => {
      if (!isDesktopApp) {
        setToast("浏览器预览不会读取本地文件夹，请在桌面应用中重建剧集。");
        return;
      }
      try {
        let newRootPath: string | null = null;
        if (needsNewLocation) {
          newRootPath = await chooseLocalFolder();
          if (!newRootPath) {
            return;
          }
        }
        await inspectRootRebuild(rootId, newRootPath);
      } catch (error) {
        setLibraryError(commandError(error).message);
      }
    },
    [inspectRootRebuild],
  );

  const openRemoteUrlImport = useCallback(() => {
    setLibraryError(null);
    setRemoteUrlDialogOpen(true);
  }, []);

  useEffect(() => {
    const startupMediaPath = appStatus?.startupMediaPath;
    if (
      !isDesktopApp ||
      !startupMediaPath ||
      libraryState.loading ||
      startupMediaHandledRef.current
    ) {
      return;
    }
    startupMediaHandledRef.current = true;
    void importMediaPath(startupMediaPath);
  }, [appStatus, importMediaPath, libraryState.loading]);

  useEffect(() => {
    const handleOpenShortcut = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        event.key.toLowerCase() === "o" &&
        !deleteCandidate &&
        !subtitleDialogOpen &&
        !translationDialogOpen &&
        !revisionDialogOpen &&
        !deliveryDialogOpen &&
        !remoteUrlDialogOpen &&
        libraryState.folderImport.stage === "closed" &&
        libraryState.recovery.stage === "closed" &&
        !busyMessage
      ) {
        event.preventDefault();
        if (event.shiftKey) {
          void importLocalFolder();
        } else {
          void importLocalVideo();
        }
      }
    };
    window.addEventListener("keydown", handleOpenShortcut);
    return () => window.removeEventListener("keydown", handleOpenShortcut);
  }, [
    busyMessage,
    deleteCandidate,
    deliveryDialogOpen,
    importLocalFolder,
    importLocalVideo,
    libraryState.folderImport.stage,
    libraryState.recovery.stage,
    remoteUrlDialogOpen,
    revisionDialogOpen,
    subtitleDialogOpen,
    translationDialogOpen,
  ]);

  const relinkProject = useCallback(async (project: Project) => {
    try {
      const mediaPath = await chooseLocalVideo();
      if (!mediaPath) {
        return;
      }
      setBusyMessage("正在重新关联媒体…");
      const relinked = await relinkProjectMedia(project.id, mediaPath);
      setBusyMessage(null);
      await prepareAndOpen(relinked, false, null);
    } catch (error) {
      setBusyMessage(null);
      setLibraryError(commandError(error).message);
    }
  }, [prepareAndOpen]);

  const openLibraryMedia = useCallback(
    async (media: LibraryMediaSummary) => {
      try {
        const project = await getProject(media.projectId);
        await prepareAndOpen(
          project,
          false,
          media.collectionId
            ? {
                collectionId: media.collectionId,
                seasonNumber: media.seasonNumber,
              }
            : null,
        );
      } catch (error) {
        setLibraryError(commandError(error).message);
      }
    },
    [prepareAndOpen],
  );

  const relinkLibraryMedia = useCallback(async (media: LibraryMediaSummary) => {
    try {
      const project = await getProject(media.projectId);
      await relinkProject(project);
    } catch (error) {
      setLibraryError(commandError(error).message);
    }
  }, [relinkProject]);

  const deleteLibraryMedia = useCallback(async (media: LibraryMediaSummary) => {
    try {
      setDeleteCandidate(await getProject(media.projectId));
    } catch (error) {
      setLibraryError(commandError(error).message);
    }
  }, []);

  const selectLibrarySection = useCallback(
    (section: Parameters<typeof setLibrarySection>[0]) => {
      if (screen !== "library") {
        returnToLibrary();
      }
      setLibrarySection(section);
    },
    [returnToLibrary, screen, setLibrarySection],
  );

  const openLibrarySearchResult = useCallback(
    (result: LibrarySearchResult) => {
      setSearchQuery("");
      if (result.kind === "collection" && result.collectionId) {
        selectLibrarySection("series");
        void openCollection(result.collectionId);
      } else if (result.projectId) {
        void getProject(result.projectId)
          .then((project) =>
            prepareAndOpen(
              project,
              false,
              result.collectionId
                ? {
                    collectionId: result.collectionId,
                    seasonNumber: result.seasonNumber,
                  }
                : null,
            ),
          )
          .catch((error: unknown) => setLibraryError(commandError(error).message));
      }
    },
    [
      openCollection,
      prepareAndOpen,
      setSearchQuery,
      selectLibrarySection,
    ],
  );

  const switchEpisode = useCallback(
    async (episode: EpisodeReference) => {
      if (!episodeContext) {
        throw new Error("当前视频不属于可导航的剧集");
      }
      try {
        const project = await getProject(episode.projectId);
        await prepareAndOpen(project, false, {
          collectionId: episodeContext.collectionId,
          seasonNumber: episode.seasonNumber,
        });
      } catch (error) {
        setToast(commandError(error).message);
        throw error;
      }
    },
    [episodeContext, prepareAndOpen],
  );

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

  useEffect(() => {
    if (
      !trackedTranscriptionJobId ||
      subtitleDialogOpen ||
      !activeProjectId
    ) {
      return undefined;
    }

    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const job = await getTranscriptionJob(trackedTranscriptionJobId);
        if (!active) {
          return;
        }
        if (activeTranscriptionStatuses.has(job.status)) {
          timer = window.setTimeout(() => void poll(), 900);
          return;
        }

        if (
          job.status !== "completed" ||
          !job.subtitleVersionId ||
          job.projectId !== activeProjectId
        ) {
          setTrackedTranscriptionJobId((current) =>
            current === job.id ? null : current,
          );
          return;
        }
        const versions = await listSubtitleVersions(activeProjectId);
        if (!active) {
          return;
        }
        const version = versions.find(
          (item) => item.id === job.subtitleVersionId,
        );
        if (!version) {
          throw new Error("生成的字幕版本暂时无法读取");
        }
        if (!subtitleVersions.some((item) => item.id === version.id)) {
          await handleSubtitleVersionCreated(
            version,
            `已生成 ${version.segments.length} 条原文字幕草稿，可以开始抽查。`,
          );
        }
        setTrackedTranscriptionJobId((current) =>
          current === job.id ? null : current,
        );
      } catch (error) {
        if (active) {
          setToast(commandError(error).message);
          timer = window.setTimeout(() => void poll(), 1_500);
        }
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [
    activeProjectId,
    handleSubtitleVersionCreated,
    subtitleDialogOpen,
    subtitleVersions,
    trackedTranscriptionJobId,
  ]);

  const currentSubtitle =
    subtitleVersions.find(
      (version) => version.role === "original" && version.isCurrent,
    ) ?? null;
  const currentTranslation =
    subtitleVersions.find(
      (version) => version.role === "translation" && version.isCurrent,
    ) ?? null;
  const dropFeedback = useDesktopMediaDrop({
    enabled: isDesktopApp,
    onImportMedia: importMediaPath,
    onNotice: setToast,
  });

  return (
    <div className="app-root">
      <DesktopShell
        activeView={screen}
        navigationCollapsed={shellController.state.navigationCollapsed}
        drawerTab={shellController.state.drawerTab}
        dropFeedback={dropFeedback}
        appStatus={appStatus}
        runtimeStatus={runtimeStatus}
        previewMode={!isDesktopApp}
        mediaTitle={screen === "library" ? null : activeProject?.title ?? null}
        currentSubtitleCount={currentSubtitle?.segments.length ?? null}
        currentTranslationCount={currentTranslation?.segments.length ?? null}
        canReviseSubtitles={Boolean(currentSubtitle)}
        canDeliverSubtitles={Boolean(currentSubtitle || currentTranslation)}
        libraryCounts={{
          continueWatching: libraryState.home.continueWatching.length,
          episodeFiles: libraryState.home.totalProjectCount,
          series: libraryState.home.collections.filter(
            (collection) => collection.systemKey === null,
          ).length,
          folders: libraryState.home.folders.length,
          watchLater:
            libraryState.home.collections.find(
              (collection) => collection.systemKey === "watch_later",
            )?.itemCount ?? 0,
          unclassified: libraryState.home.unclassifiedCount,
        }}
        librarySection={libraryState.section}
        searchQuery={libraryState.searchQuery}
        searchResults={libraryState.searchResults}
        searchLoading={libraryState.searchLoading}
        onToggleNavigation={shellController.toggleNavigation}
        onToggleDrawer={shellController.toggleDrawer}
        onGoLibrary={returnToLibrary}
        onSelectLibrarySection={selectLibrarySection}
        onSearchQueryChange={setSearchQuery}
        onOpenSearchResult={openLibrarySearchResult}
        onOpenFile={() => void importLocalVideo()}
        onOpenFolder={() => void importLocalFolder()}
        onOpenUrl={openRemoteUrlImport}
        onManageSubtitles={() => setSubtitleDialogOpen(true)}
        onManageTranslation={() => {
          setTranslationSegmentIds(undefined);
          setTranslationDialogOpen(true);
        }}
        onReviseSubtitles={() => setRevisionDialogOpen(true)}
        onDeliverSubtitles={() => setDeliveryDialogOpen(true)}
        onOpenSettings={openRuntimeSettings}
      >
        {screen === "library" ? (
          <LibraryScreen
            home={libraryState.home}
            section={libraryState.section}
            currentCollection={libraryState.currentCollection}
            currentEpisodes={libraryState.currentEpisodes}
            selectedSeason={libraryState.selectedSeason}
            loading={libraryState.loading}
            collectionLoading={libraryState.collectionLoading}
            mutationPending={libraryState.mutationPending}
            error={libraryError ?? libraryState.error}
            previewMode={!isDesktopApp}
            onImport={() => void importLocalVideo()}
            onImportFolder={() => void importLocalFolder()}
            onImportUrl={openRemoteUrlImport}
            onRescanRoot={(rootId) => void inspectRootRescan(rootId)}
            onRelocateRoot={(rootId) => void relocateLibraryRoot(rootId)}
            onRebuildRoot={(rootId, needsNewLocation) =>
              void rebuildLibraryRoot(rootId, needsNewLocation)
            }
            onRevokeRoot={(rootId) => void revokeRoot(rootId)}
            onOpen={(media) => void openLibraryMedia(media)}
            onRelink={(media) => void relinkLibraryMedia(media)}
            onDelete={(media) => void deleteLibraryMedia(media)}
            onOpenLocation={(media) =>
              void openProjectMediaLocation(media.projectId).catch((error: unknown) =>
                setLibraryError(commandError(error).message),
              )
            }
            onSelectSection={selectLibrarySection}
            onOpenCollection={(collectionId) =>
              void openCollection(collectionId)
            }
            onCloseCollection={closeCollection}
            onSelectSeason={selectSeason}
            onCreateCollection={createManualCollection}
            onUpdateCollection={editCollection}
            onDeleteCollection={removeCollection}
            onAddToCollection={addToCollection}
            onRemoveFromCollection={removeFromCollection}
            onSetWatchLater={changeWatchLater}
          />
        ) : null}

        {screen === "preparing" && activeProject ? (
          <PreparationScreen
            project={activeProject}
            forceProxy={forceProxy}
            error={preparationError}
            onRetry={() =>
              void prepareAndOpen(activeProject, forceProxy, episodeContext)
            }
            onBack={returnToLibrary}
          />
        ) : null}

        {screen === "player" && activeProject && preparation ? (
          <PlayerScreen
            key={preparation.playbackPath}
            project={activeProject}
            preparation={preparation}
            currentSubtitle={currentSubtitle}
            currentTranslation={currentTranslation}
            drawerTab={shellController.state.drawerTab}
            contextMenu={shellController.state.contextMenu}
            episodeNavigation={episodeNavigation.state}
            onBack={returnToLibrary}
            onCloseDrawer={shellController.closeDrawer}
            onSelectDrawer={shellController.selectDrawer}
            onOpenContextMenu={shellController.openContextMenu}
            onCloseContextMenu={shellController.closeContextMenu}
            onManageSubtitles={() => setSubtitleDialogOpen(true)}
            onNeedProxy={() =>
              void prepareAndOpen(activeProject, true, episodeContext)
            }
            onPersist={persistPlayback}
            onSwitchEpisode={switchEpisode}
            onError={(message) => {
              setPreparationError(message);
              setForceProxy(true);
              setScreen("preparing");
            }}
          />
        ) : null}
      </DesktopShell>

      {runtimeSettingsOpen ? (
        <RuntimeSettingsDialog
          catalog={runtimeCatalog}
          loading={runtimeCatalogLoading}
          previewMode={!isDesktopApp}
          onClose={() => setRuntimeSettingsOpen(false)}
          onCatalogChange={handleRuntimeCatalogChange}
          onError={setToast}
          sharedCatalog={sharedCatalog}
          sharedRoot={sharedRoot}
          sharedInstallations={sharedInstallations}
          onRefreshShared={refreshSharedComponents}
        />
      ) : null}

      {libraryState.folderImport.stage !== "closed" ? (
        <LibraryFolderImportDialog
          state={libraryState.folderImport}
          onClose={closeFolderImport}
          onCancelScan={cancelFolderScan}
          onTitleChange={setFolderImportTitle}
          onItemChange={updateFolderImportItem}
          onConfirmFingerprintDuplicatesChange={setConfirmFingerprintDuplicates}
          onImport={importScannedFolder}
        />
      ) : null}

      {libraryState.recovery.stage !== "closed" ? (
        <LibraryRecoveryDialog
          state={libraryState.recovery}
          onClose={closeRecovery}
          onItemChange={updateRecoveryItem}
          onConfirmationChange={setRecoveryConfirmation}
          onRebuildTitleChange={setRebuildCollectionTitle}
          onApplyRescan={applyRescan}
          onApplyRebuild={applyRebuild}
          onApplyRelocation={applyRootRelocation}
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
          onTranscriptionTracked={setTrackedTranscriptionJobId}
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
            void prepareAndOpen(project, false, null);
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
