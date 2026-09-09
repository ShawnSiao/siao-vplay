import { useStorageMigrationCancellation } from "./useStorageMigrationCancellation";
import { useStorageMigrationPolling } from "./useStorageMigrationPolling";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  StorageSettings,
} from "../../types";
import type {
  StorageArea,
  StorageLocationKind,
  StorageMigrationMode,
  StorageMigrationTask,
} from "./types";
import {
  chooseStorageDirectory,
  clearPlaybackCache,
  getCurrentStorageMigration,
  getStorageSettings,
  openStorageLocation,
  prepareStorageMigration,
  restartAfterStorageMigration,
  resumeStorageMigration,
  saveStorageSettings,
  startStorageMigration,
} from "./gateway";

type Operation = "loading" | "saving" | "preparing" | "starting" | "cancelling" | "clearing";

const previewSettings: StorageSettings = {
  revision: 1,
  appDataRoot: "C:\\Users\\Shawn\\AppData\\Local\\app.siaovplay.desktop",
  appDataRootLockedByEnvironment: false,
  remoteMediaRoot: "C:\\Users\\Shawn\\AppData\\Local\\app.siaovplay.desktop\\remote-media",
  remoteMediaUsesDefault: true,
  mediaCacheRoot: "C:\\Users\\Shawn\\AppData\\Local\\app.siaovplay.desktop\\media-cache",
  mediaCacheUsesDefault: true,
  defaultSubtitleExportDirectory: null,
  defaultVideoReportExportDirectory: "D:\\SiaoVPlay\\Exports",
  appDataUsedBytes: 851_443_712,
  appDataFreeSpaceBytes: 51_539_607_552,
  remoteMediaUsedBytes: 143_654_912,
  mediaCacheUsedBytes: 671_088_640,
  appDataAvailable: true,
  remoteMediaAvailable: true,
  mediaCacheAvailable: true,
  pendingAppDataRoot: null,
};

function message(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause && typeof cause === "object" && "message" in cause) {
    const value = (cause as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "存储操作没有完成，请检查目录后重试。";
}

export function useStorageSettings(
  active: boolean,
  previewMode: boolean,
  onNotice: (message: string) => void,
) {
  const [settings, setSettings] = useState<StorageSettings | null>(null);
  const [subtitleDirectory, setSubtitleDirectory] = useState<string | null>(null);
  const [reportDirectory, setReportDirectory] = useState<string | null>(null);
  const [migration, setMigration] = useState<StorageMigrationTask | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastStatus = useRef<string | null>(null);
  const settingsReadEpoch = useRef(0);
  const noticeRef = useRef(onNotice);
  useEffect(() => { noticeRef.current = onNotice; }, [onNotice]);

  const appliedSettings = useRef<StorageSettings | null>(null);
  const applySettings = useCallback((next: StorageSettings, saved?: { subtitle: string | null; report: string | null }) => {
    const previous = appliedSettings.current;
    appliedSettings.current = next;
    setSettings(next);
    setSubtitleDirectory(current => !previous || current === (saved ? saved.subtitle : previous.defaultSubtitleExportDirectory)
      ? next.defaultSubtitleExportDirectory : current);
    setReportDirectory(current => !previous || current === (saved ? saved.report : previous.defaultVideoReportExportDirectory)
      ? next.defaultVideoReportExportDirectory : current);
  }, []);

  const load = useCallback(async () => {
    const epoch = ++settingsReadEpoch.current;
    setOperation("loading");
    setError(null);
    try {
      if (previewMode) {
        applySettings(previewSettings);
        setMigration(null);
      } else {
        const [nextSettings, currentMigration] = await Promise.all([
          getStorageSettings(),
          getCurrentStorageMigration(),
        ]);
        if (epoch !== settingsReadEpoch.current) return;
        applySettings(nextSettings);
        setMigration(currentMigration);
      }
    } catch (cause) {
      if (epoch === settingsReadEpoch.current) setError(message(cause));
    } finally {
      if (epoch === settingsReadEpoch.current) setOperation(null);
    }
  }, [applySettings, previewMode]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [active, load]);

  useStorageMigrationPolling(active && !previewMode, migration, setMigration, cause => setError(message(cause)));

  useEffect(() => {
    let active = true;
    const status = migration?.status ?? null;
    const identity = migration?.id ? `${migration.id}:${status}` : null;
    const epoch = settingsReadEpoch.current;
    if (status && identity !== lastStatus.current && ["completed", "restart_required"].includes(status)) {
      noticeRef.current(status === "restart_required" ? "应用数据已校验，重启后切换到新位置。" : "存储位置迁移完成，旧目录仍保留。");
      if (!previewMode) void getStorageSettings().then(next => {
        if (active && epoch === settingsReadEpoch.current) applySettings(next);
      }).catch(cause => {
        if (active && epoch === settingsReadEpoch.current) setError(`迁移状态已更新，但存储设置刷新失败：${message(cause)}`);
      });
    }
    lastStatus.current = identity;
    return () => { active = false; };
  }, [applySettings, migration?.id, migration?.status, previewMode]);

  const chooseDefault = useCallback(async (kind: "subtitle" | "report") => {
    const selected = previewMode
      ? kind === "subtitle" ? "D:\\SiaoVPlay\\Subtitles" : "D:\\SiaoVPlay\\Exports"
      : await chooseStorageDirectory(
        kind === "subtitle" ? "选择默认字幕导出位置" : "选择默认视频及报告保存位置",
      );
    if (selected) {
      if (kind === "subtitle") setSubtitleDirectory(selected);
      else setReportDirectory(selected);
    }
  }, [previewMode]);

  const saveDefaults = useCallback(async () => {
    if (!settings) return;
    ++settingsReadEpoch.current;
    setOperation("saving");
    setError(null);
    try {
      if (previewMode) {
        applySettings({ ...settings, defaultSubtitleExportDirectory: subtitleDirectory, defaultVideoReportExportDirectory: reportDirectory }, { subtitle: subtitleDirectory, report: reportDirectory });
      } else {
        applySettings(await saveStorageSettings({
          expectedRevision: settings.revision,
          remoteMediaRoot: settings.remoteMediaUsesDefault ? null : settings.remoteMediaRoot,
          mediaCacheRoot: settings.mediaCacheUsesDefault ? null : settings.mediaCacheRoot,
          defaultSubtitleExportDirectory: subtitleDirectory,
          defaultVideoReportExportDirectory: reportDirectory,
        }), { subtitle: subtitleDirectory, report: reportDirectory });
      }
      onNotice("默认保存位置已更新；导出时仍可临时改选。");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setOperation(null);
    }
  }, [applySettings, onNotice, previewMode, reportDirectory, settings, subtitleDirectory]);

  const prepare = useCallback(async (
    area: StorageArea,
    destination: string,
    mode: StorageMigrationMode,
  ) => {
    setOperation("preparing");
    setError(null);
    try {
      if (previewMode) {
        const timestamp = Date.now();
        const sourceRoot = area === "app_data" ? previewSettings.appDataRoot : area === "remote_media" ? previewSettings.remoteMediaRoot : previewSettings.mediaCacheRoot;
        const task: StorageMigrationTask = {
          id: `preview-${area}`,
          area,
          mode,
          status: "prepared",
          sourceRoot,
          destinationRoot: destination,
          bytesToCopy: mode === "rebuild" ? 0 : area === "app_data" ? previewSettings.appDataUsedBytes : area === "remote_media" ? previewSettings.remoteMediaUsedBytes : previewSettings.mediaCacheUsedBytes,
          copiedBytes: 0,
          fileCount: mode === "rebuild" ? 0 : 42,
          verifiedFileCount: 0,
          freeSpaceBytes: 312 * 1024 ** 3,
          previousRootRetained: true,
          restartRequired: area === "app_data",
          errorCode: null,
          errorMessage: null,
          createdAtMs: timestamp,
          updatedAtMs: timestamp,
        };
        setMigration(task);
        return task;
      }
      const task = await prepareStorageMigration(area, destination, mode);
      setMigration(task);
      return task;
    } catch (cause) {
      setError(message(cause));
      return null;
    } finally {
      setOperation(null);
    }
  }, [previewMode]);

  const runTask = useCallback(async (resume: boolean) => {
    if (!migration) return;
    setOperation("starting");
    setError(null);
    try {
      if (previewMode) {
        setMigration({ ...migration, status: migration.area === "app_data" ? "restart_required" : "completed", copiedBytes: migration.bytesToCopy, verifiedFileCount: migration.fileCount });
      } else {
        setMigration(await (resume ? resumeStorageMigration(migration.id) : startStorageMigration(migration.id)));
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setOperation(null);
    }
  }, [migration, previewMode]);

  const cancellation = useStorageMigrationCancellation(migration, previewMode, setMigration, cause => setError(message(cause)));

  const clearCache = useCallback(async () => {
    setOperation("clearing");
    setError(null);
    try {
      if (!previewMode) await clearPlaybackCache();
      if (settings) applySettings({ ...settings, mediaCacheUsedBytes: 0 });
      onNotice("播放缓存已清理，需要时会自动重新生成。");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setOperation(null);
    }
  }, [applySettings, onNotice, previewMode, settings]);

  const openLocation = useCallback(async (kind: StorageLocationKind) => {
    if (previewMode) return;
    setError(null);
    try {
      await openStorageLocation(kind);
    } catch (cause) {
      setError(message(cause));
    }
  }, [previewMode]);

  return {
    settings, subtitleDirectory, reportDirectory, migration, operation: cancellation.cancelling ? "cancelling" as const : operation, error,
    setSubtitleDirectory, setReportDirectory, chooseDefault, saveDefaults, prepare,
    start: () => runTask(false), resume: () => runTask(true), cancel: cancellation.cancel, clearCache,
    openLocation,
    chooseMigrationDirectory: () => previewMode ? Promise.resolve("W:\\SiaoVPlay\\Storage") : chooseStorageDirectory("选择空的迁移目标文件夹"),
    restart: () => previewMode ? Promise.resolve() : restartAfterStorageMigration(),
    clearError: () => setError(null), reload: load,
  };
}

export type StorageSettingsController = ReturnType<typeof useStorageSettings>;
