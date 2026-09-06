import { SubtitleHistoryLoader } from "./features/subtitle-revision/SubtitleHistoryLoader";
import { useCallback, useEffect, useRef, useState } from "react";

import { useOpeningIntent, type IsCurrentOpening } from "./features/playback/useOpeningIntent";
import { useLibrarySearchOpening } from "./features/library/useLibrarySearchOpening";
import { SummaryActivityMenu } from "./features/summary/SummaryActivityMenu";
import { Dialog } from "./components/Dialog";
import { AppToast, type ToastNotice } from "./components/AppToast";
import { LibraryFolderImportDialog } from "./components/LibraryFolderImportDialog";
import { LibraryRecoveryDialog } from "./components/LibraryRecoveryDialog";
import { LibraryScreen } from "./components/LibraryScreen";
import { PlayerScreen } from "./features/playback/PlayerScreen";
import { useMediaPreparation } from "./features/playback/useMediaPreparation";
import { usePlaybackPersistence } from "./features/playback/usePlaybackPersistence";
import { useLibraryController } from "./features/library/useLibraryController";
import { usePosterQueue } from "./features/library/usePosterQueue";
import { openProjectMediaLocation } from "./features/library/libraryGateway";
import {
  useEpisodeNavigation,
  type EpisodePlaybackContext,
} from "./features/library/useEpisodeNavigation";
import { PreparationScreen } from "./components/PreparationScreen";
import { RemoteUrlDialog } from "./components/RemoteUrlDialog";
import { EnvironmentSettingsDialog } from "./features/environment-settings/EnvironmentSettingsDialog";
import { backgroundResultNotice } from "./features/ai-tasks/backgroundNotice";
import type { PendingResourceAction } from "./features/environment-settings/LocalFeaturesDialog";
import { SubtitleImportDialog } from "./components/SubtitleImportDialog";
import { SubtitleDeliveryDialog } from "./components/SubtitleDeliveryDialog";
import { SubtitleRevisionDialog } from "./components/SubtitleRevisionDialog";
import { TranslationDialog } from "./components/TranslationDialog";
import { DesktopShell } from "./features/shell/DesktopShell";
import { useDesktopMediaDrop } from "./features/shell/useDesktopMediaDrop";
import { useShellController } from "./features/shell/useShellController";
import { useLocalResources } from "./features/resources/useLocalResources";
import {
  chooseLocalFolder,
  chooseLocalVideo,
  createLocalProject,
  deleteProject,
  getAppStatus,
  getTranscriptionJob,
  getProject,
  isDesktopApp,
  listProjects,
  listSubtitleVersions,
  markProjectOpened,
  reconcileExternalAgentResults,
  relinkProjectMedia,
  setMainWindowMediaTitle,
} from "./lib/desktop";
import { userFacingCommandError } from "./lib/userFacingError";
import type {
  AppStatus,
  MediaPreparation,
  Project,
  SubtitleVersion,
  TranscriptionJob,
  TranslationTask,
  LibraryMediaSummary,
  EpisodeReference,
} from "./types";

const activeTranscriptionStatuses = new Set<TranscriptionJob["status"]>(
  ["queued", "extracting", "transcribing", "validating"],
);

type PendingResourceResume = PendingResourceAction & { resume: () => Promise<void> | void };

export default function App() {
  const shellController = useShellController();
  const mediaPreparation = useMediaPreparation();
  const startMediaPreparation = mediaPreparation.start;
  const resetMediaPreparation = mediaPreparation.reset;
  const localResources = useLocalResources();
  const localResourceStatus = localResources.status;
  const refreshLocalResources = localResources.refresh;
  const {
    state: libraryState,
    refresh: refreshLibrary,
    setSection: setLibrarySection,
    loadSectionPage,
    loadMoreSection,
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
    changeWatched,
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
  const openingIntent = useOpeningIntent();
  const [sessionId, setSessionId] = useState(0);
  const startupMediaHandledRef = useRef(false);
  const externalResultScanRef = useRef(false);
  const pendingResourceResumeRef = useRef<PendingResourceResume | null>(null);
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
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
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const [localResourcesOpen, setLocalResourcesOpen] = useState(false);
  const [pendingResourceAction, setPendingResourceAction] =
    useState<PendingResourceAction | null>(null);
  const episodeNavigation = useEpisodeNavigation(
    episodeContext,
    activeProject?.id ?? null,
  );

  usePosterQueue({
    enabled: isDesktopApp && screen === "library",
    projects,
    refreshLibrary,
    setProjects,
    setActiveProject,
  });

  const openLocalResources = useCallback(() => {
    pendingResourceResumeRef.current = null;
    setPendingResourceAction(null);
    setLocalResourcesOpen(true);
    void refreshLocalResources().catch(() => undefined);
  }, [refreshLocalResources]);

  const refreshProjects = useCallback(async () => {
    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      setLibraryError(null);
      await refreshLibrary();
    } catch (error) {
      setLibraryError(userFacingCommandError(error, "library"));
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
          setLibraryError(userFacingCommandError(error, "library"));
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
          setLibraryError(userFacingCommandError(error, "library"));
        }
      })
    return () => {
      active = false;
    };
  }, []);

  const requestCapability = useCallback(
    async (
      capabilityId: string,
      label: string,
      resume: () => Promise<void> | void,
      profileId?: "fast" | "standard",
      isCurrent: IsCurrentOpening = () => true,
    ) => {
      if (!isCurrent()) return;
      if (!isDesktopApp) {
        await resume();
        return;
      }
      const currentStatus = await refreshLocalResources();
      if (!isCurrent()) return;
      const capability = currentStatus.capabilities.find(
        (item) => item.id === capabilityId,
      );
      if (capability?.state === "ready") {
        await resume();
        return;
      }
      const pending: PendingResourceResume = {
        id: crypto.randomUUID(),
        capabilityId,
        label,
        profileId,
        resume,
      };
      pendingResourceResumeRef.current = pending;
      setPendingResourceAction({
        id: pending.id,
        capabilityId: pending.capabilityId,
        label: pending.label,
        profileId: pending.profileId,
      });
      setLocalResourcesOpen(true);
    },
    [refreshLocalResources],
  );

  const closeLocalResources = useCallback(() => {
    if (pendingResourceResumeRef.current) {
      setToast("此次操作已取消；已开始的功能准备任务不会被删除。");
    }
    pendingResourceResumeRef.current = null;
    setPendingResourceAction(null);
    setLocalResourcesOpen(false);
  }, []);

  useEffect(() => {
    const pending = pendingResourceResumeRef.current;
    if (!pending || pending.id !== pendingResourceAction?.id) {
      return;
    }
    const capability = localResourceStatus?.capabilities.find(
      (item) => item.id === pending.capabilityId,
    );
    if (capability?.state !== "ready") {
      return;
    }
    const timer = window.setTimeout(() => {
      if (pendingResourceResumeRef.current?.id !== pending.id) {
        return;
      }
      pendingResourceResumeRef.current = null;
      setPendingResourceAction(null);
      setLocalResourcesOpen(false);
      setToast(`${pending.label}：所需功能已准备完成。`);
      void Promise.resolve(pending.resume()).catch((error: unknown) =>
        setToast(userFacingCommandError(error, "settings")),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [localResourceStatus, pendingResourceAction?.id]);

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

  const prepareAndOpenReady = useCallback(
    async (
      project: Project,
      shouldForceProxy: boolean,
      nextEpisodeContext: EpisodePlaybackContext | null,
      isCurrent: IsCurrentOpening = () => true,
    ) => {
      if (!isCurrent()) return;
      setBusyMessage(null);
      resetMediaPreparation();
      const token = operationTokenRef.current + 1;
      operationTokenRef.current = token;
      setSessionId(token);
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
        if (operationTokenRef.current !== token) {
          window.clearTimeout(preparationTimer);
          return;
        }
        const result = await startMediaPreparation(
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
        void listSubtitleVersions(openedProject.id, false)
          .then((versions) => {
            if (operationTokenRef.current === token) {
              setSubtitleVersions(versions);
            }
          })
          .catch((error: unknown) => {
            if (operationTokenRef.current === token) {
              setToast(userFacingCommandError(error, "subtitle"));
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
        setPreparationError(userFacingCommandError(error, "playback"));
      }
    },
    [refreshProjects, setScreen, startMediaPreparation, resetMediaPreparation],
  );

  const prepareAndOpen = useCallback(
    async (source: Project | (() => Promise<Project>), shouldForceProxy: boolean, context: EpisodePlaybackContext | null) => {
      await openingIntent.run(async (isCurrent) => {
        const project = typeof source === "function" ? await source() : source;
        if (!isCurrent()) return;
        await requestCapability("basic_media", `继续播放「${project.title}」`,
          () => prepareAndOpenReady(project, shouldForceProxy, context, isCurrent), undefined, isCurrent);
      });
    }, [openingIntent, prepareAndOpenReady, requestCapability],
  );

  const returnToLibrary = useCallback(() => {
    openingIntent.invalidate();
    setBusyMessage(null);
    operationTokenRef.current += 1;
    setSessionId(operationTokenRef.current);
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
  }, [openingIntent, refreshProjects, setLibrarySection, setScreen]);

  const importMediaPathReady = useCallback(
    async (mediaPath: string, isCurrent: IsCurrentOpening) => {
      try {
        if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        setBusyMessage(null);
        await prepareAndOpenReady(project, false, null, isCurrent);
      } catch (error) {
        if (!isCurrent()) return;
        setBusyMessage(null);
        setLibraryError(userFacingCommandError(error, "library"));
      }
    },
    [prepareAndOpenReady, projects],
  );

  const importMediaPath = useCallback(
    async (source: string | (() => Promise<string | null>)) => {
      await openingIntent.run(async (isCurrent) => {
        const path = typeof source === "function" ? await source() : source;
        if (!path || !isCurrent()) return;
        await requestCapability("basic_media", "继续打开本地视频",
          () => importMediaPathReady(path, isCurrent), undefined, isCurrent);
      });
    }, [importMediaPathReady, openingIntent, requestCapability],
  );

  const importLocalVideo = useCallback(async () => {
    if (!isDesktopApp) {
      setToast("浏览器预览不会读取本地文件，请在桌面应用中体验导入。");
      return;
    }
    try {
      await importMediaPath(chooseLocalVideo);
    } catch (error) {
      setBusyMessage(null);
      setLibraryError(userFacingCommandError(error, "library"));
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
      setLibraryError(userFacingCommandError(error, "library"));
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
        setLibraryError(userFacingCommandError(error, "library"));
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
        setLibraryError(userFacingCommandError(error, "library"));
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

  const relinkProject = useCallback(async (source: Project | (() => Promise<Project>)) => {
    await openingIntent.run(async (isCurrent) => {
      try {
        const project = typeof source === "function" ? await source() : source;
        if (!isCurrent()) return;
        const mediaPath = await chooseLocalVideo();
        if (!mediaPath || !isCurrent()) return;
        setBusyMessage("正在重新关联媒体…");
        const relinked = await relinkProjectMedia(project.id, mediaPath);
        if (!isCurrent()) return;
        setBusyMessage(null);
        await requestCapability("basic_media", `继续播放「${project.title}」`,
          () => prepareAndOpenReady(relinked, false, null, isCurrent), undefined, isCurrent);
      } catch (error) {
        if (!isCurrent()) return;
        setBusyMessage(null);
        setLibraryError(userFacingCommandError(error, "library"));
      }
    });
  }, [openingIntent, prepareAndOpenReady, requestCapability]);

  const openLibraryMedia = useCallback(
    async (media: LibraryMediaSummary) => {
      try {
        await prepareAndOpen(
          () => getProject(media.projectId),
          false,
          media.collectionId
            ? {
                collectionId: media.collectionId,
                seasonNumber: media.seasonNumber,
              }
            : null,
        );
      } catch (error) {
        setLibraryError(userFacingCommandError(error, "library"));
      }
    },
    [prepareAndOpen],
  );

  const relinkLibraryMedia = useCallback(async (media: LibraryMediaSummary) => {
    try {
      await relinkProject(() => getProject(media.projectId));
    } catch (error) {
      setLibraryError(userFacingCommandError(error, "library"));
    }
  }, [relinkProject]);

  const deleteLibraryMedia = useCallback(async (media: LibraryMediaSummary) => {
    try {
      setDeleteCandidate(await getProject(media.projectId));
    } catch (error) {
      setLibraryError(userFacingCommandError(error, "library"));
    }
  }, []);

  const selectLibrarySection = useCallback(
    (section: Parameters<typeof setLibrarySection>[0]) => {
      openingIntent.invalidate();
      if (screen !== "library") {
        returnToLibrary();
      }
      setLibrarySection(section);
    },
    [openingIntent, returnToLibrary, screen, setLibrarySection],
  );

  const reportLibraryError = useCallback((error: unknown) => setLibraryError(userFacingCommandError(error, "library")), []);
  const openLibrarySearchResult = useLibrarySearchOpening({
    clearSearch: setSearchQuery, selectSection: selectLibrarySection, openCollection,
    openProject: prepareAndOpen, onError: reportLibraryError,
  });

  const switchEpisode = useCallback(
    async (episode: EpisodeReference) => {
      if (!episodeContext) {
        throw new Error("当前视频不属于可导航的剧集");
      }
      try {
        await prepareAndOpen(() => getProject(episode.projectId), false, {
          collectionId: episodeContext.collectionId,
          seasonNumber: episode.seasonNumber,
        });
      } catch (error) {
        setToast(userFacingCommandError(error, "playback"));
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
      setLibraryError(userFacingCommandError(error, "library"));
    }
  };

  const persistPlayback = usePlaybackPersistence({
    project: activeProject, sessionId, currentSession: operationTokenRef,
    setProject: setActiveProject, setProjects, onFailure: setToast,
  });
  const isCurrentSession = useCallback((projectId: string) =>
    operationTokenRef.current === sessionId && activeProject?.id === projectId,
  [activeProject?.id, sessionId]);

  const mergeSubtitleVersion = useCallback((version: SubtitleVersion) => {
    if (!isCurrentSession(version.projectId)) return;
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
  }, [isCurrentSession]);

  const handleTranslationCompleted = useCallback(
    async (task: TranslationTask, version?: SubtitleVersion) => {
      if (version) {
        mergeSubtitleVersion(version);
      } else {
        const versions = await listSubtitleVersions(task.projectId);
        if (isCurrentSession(task.projectId)) setSubtitleVersions(versions);
      }
      setToast(
        task.validation?.warningCount
          ? {
              title: "中文字幕草稿已生成",
              message: `另有 ${task.validation.warningCount} 项一致性提示，建议抽查后再使用。`,
              tone: "warning",
            }
          : {
              title: "中文字幕已准备好",
              message: `已生成 ${task.segmentCount} 条草稿，当前视频可以切换为中文或双语字幕。`,
              tone: "success",
            },
      );
      const updatedProject = await getProject(task.projectId);
      if (isCurrentSession(task.projectId)) setActiveProject(updatedProject);
      setProjects((current) =>
        current.map((project) =>
          project.id === updatedProject.id ? updatedProject : project,
        ),
      );
      void refreshProjects();
    },
    [isCurrentSession, mergeSubtitleVersion, refreshProjects],
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
        const currentProjectUpdates = activeProjectId
          ? updates.filter(
              (update) =>
                update.projectId === activeProjectId &&
                update.status !== "validating",
            )
          : [];
        const latest = currentProjectUpdates.at(-1);
        const resultNotice = latest ? backgroundResultNotice(latest) : null;
        if (resultNotice) setToast(resultNotice);
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
            listSubtitleVersions(activeProjectId, false),
            getProject(activeProjectId),
          ]);
          if (active && isCurrentSession(activeProjectId)) {
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
  }, [activeProjectId, isCurrentSession]);

  const handleSubtitleVersionCreated = useCallback(
    async (version: SubtitleVersion, message: string) => {
      mergeSubtitleVersion(version);
      const updatedProject = await getProject(version.projectId);
      if (isCurrentSession(version.projectId)) setActiveProject(updatedProject);
      setProjects((current) =>
        current.map((project) =>
          project.id === updatedProject.id ? updatedProject : project,
        ),
      );
      setToast(message);
      void refreshProjects();
    },
    [isCurrentSession, mergeSubtitleVersion, refreshProjects],
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
          setToast(userFacingCommandError(error, "subtitle"));
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
        localResourceStatus={localResources.status}
        previewMode={!isDesktopApp}
        mediaTitle={screen === "library" ? null : activeProject?.title ?? null}
        currentSubtitleCount={currentSubtitle?.segments.length ?? null}
        currentTranslationCount={currentTranslation?.segments.length ?? null}
        canReviseSubtitles={Boolean(currentSubtitle)}
        canDeliverSubtitles={Boolean(currentSubtitle || currentTranslation)}
        libraryCounts={{
          continueWatching:
            libraryState.home.continueWatchingCount ??
            libraryState.sectionPages.continue_watching.totalCount ??
            libraryState.home.continueWatching.length,
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
        activityControl={<SummaryActivityMenu onNotice={setToast} onOpen={openLibrarySearchResult} />}
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
        onOpenSettings={openLocalResources}
      >
        {screen === "library" ? (
          <LibraryScreen
            home={libraryState.home}
            section={libraryState.section}
            sectionPages={libraryState.sectionPages}
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
                setLibraryError(userFacingCommandError(error, "library")),
              )
            }
            onSelectSection={selectLibrarySection}
            onLoadMoreSection={(section) => void loadMoreSection(section)}
            onReloadSection={(section) => void loadSectionPage(section, 0)}
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
            onSetWatched={changeWatched}
          />
        ) : null}

        {screen === "preparing" && activeProject ? (
          <PreparationScreen
            project={activeProject}
            forceProxy={forceProxy}
            error={preparationError}
            progress={mediaPreparation.progress}
            cancelling={mediaPreparation.cancelling}
            canCancel={mediaPreparation.canCancel}
            onCancel={() => {
              const token = operationTokenRef.current;
              void mediaPreparation.cancel().then(() => {
                if (operationTokenRef.current === token) returnToLibrary();
              }).catch((error: unknown) => setToast(userFacingCommandError(error, "playback")));
            }}
            onRetry={() =>
              void prepareAndOpen(activeProject, forceProxy, episodeContext)
            }
            onBack={returnToLibrary}
          />
        ) : null}

        {screen === "player" && activeProject && preparation ? (
          <PlayerScreen
            key={`${sessionId}:${preparation.playbackPath}`}
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
            onNotice={(message) =>
              setToast({
                title: "播放器操作没有完成",
                message,
                tone: "warning",
              })
            }
            onRetryPlayback={() =>
              void prepareAndOpen(activeProject, true, episodeContext)
            }
          />
        ) : null}
      </DesktopShell>

      {localResourcesOpen ? (
        <EnvironmentSettingsDialog
          localResources={localResources}
          firstRun={false}
          pendingAction={pendingResourceAction}
          previewMode={!isDesktopApp}
          onClose={closeLocalResources}
          onDismissFirstRun={closeLocalResources}
          onNotice={setToast}
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
          translationVersions={subtitleVersions.filter(
            (version) => version.role === "translation",
          )}
          onClose={() => setSubtitleDialogOpen(false)}
          onTranscriptionTracked={setTrackedTranscriptionJobId}
          onTranslationTaskCompleted={handleTranslationCompleted}
          localResourceCatalog={localResources.catalog}
          localResourceStatus={localResources.status}
          onPrepareTranscriptionResources={async (profileId) => {
            if (localResources.status?.configured) {
              await localResources.selectProfile(profileId);
            }
            setSubtitleDialogOpen(false);
            await requestCapability(
              "local_transcription",
              "继续生成原文字幕",
              () => setSubtitleDialogOpen(true),
              profileId,
            );
          }}
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
          translationVersions={subtitleVersions.filter(
            (version) => version.role === "translation",
          )}
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
        <SubtitleHistoryLoader
          key={`revision:${sessionId}`}
          projectId={activeProject.id}
          onClose={() => setRevisionDialogOpen(false)}
        >{({ currentVersions, history }) => (
        <SubtitleRevisionDialog
          project={activeProject}
          versions={currentVersions}
          historyVersions={history}
          onClose={() => setRevisionDialogOpen(false)}
          onVersionCreated={handleSubtitleVersionCreated}
          onRetranslate={(segmentIds) => {
            setRevisionDialogOpen(false);
            setTranslationSegmentIds(segmentIds);
            setTranslationDialogOpen(true);
          }}
        />
        )}</SubtitleHistoryLoader>
      ) : null}

      {deliveryDialogOpen && activeProject ? (
        <SubtitleHistoryLoader
          key={`delivery:${sessionId}`}
          projectId={activeProject.id}
          onClose={() => setDeliveryDialogOpen(false)}
        >{({ currentVersions, history }) => (
        <SubtitleDeliveryDialog
          project={activeProject}
          versions={history}
          currentSubtitle={
            currentVersions.find(
              (version) => version.role === "original" && version.isCurrent,
            ) ?? null
          }
          currentTranslation={
            currentVersions.find(
              (version) =>
                version.role === "translation" && version.isCurrent,
            ) ?? null
          }
          onClose={() => setDeliveryDialogOpen(false)}
        />
        )}</SubtitleHistoryLoader>
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
        <AppToast notice={toast} onDismiss={() => setToast(null)} />
      ) : null}
    </div>
  );
}
