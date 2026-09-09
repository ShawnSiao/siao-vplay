import { useState } from "react";
import { useModalFocus } from "../../components/useModalFocus";

import type { StorageArea, StorageLocationKind, StorageMigrationMode } from "./types";
import type { StorageSettingsController } from "./useStorageSettings";
import "./storage-settings.css";

type StoragePaneProps = {
  controller: StorageSettingsController;
};

const areaLabels: Record<StorageArea, string> = {
  app_data: "应用数据与数据库",
  remote_media: "URL 导入视频",
  media_cache: "播放缓存",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function StorageRow(props: {
  index: number;
  title: string;
  helper: string;
  path: string;
  size?: number | null;
  unavailable?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`storage-settings-row${props.unavailable ? " unavailable" : ""}`}>
      <span className="storage-row-index" aria-hidden="true">{props.index}</span>
      <span className="storage-row-copy"><strong>{props.title}</strong><small>{props.helper}</small></span>
      <span className="storage-row-path" title={props.path}>{props.unavailable ? "原位置不可用，请重新连接磁盘或迁移到新位置" : props.path}</span>
      <span className="storage-row-size">{props.size === undefined ? "" : formatBytes(props.size)}</span>
      <span className="storage-row-actions">{props.children}</span>
    </div>
  );
}

function MigrationDialog({
  area,
  controller,
  onClose,
}: {
  area: StorageArea;
  controller: StorageSettingsController;
  onClose: () => void;
}) {
  const existing = controller.migration?.area === area && controller.migration.status !== "completed"
    ? controller.migration
    : null;
  const [taskId, setTaskId] = useState(existing?.id ?? null);
  const [destination, setDestination] = useState(existing?.destinationRoot ?? "");
  const [mode, setMode] = useState<StorageMigrationMode>(existing?.mode ?? "copy");
  const task = controller.migration?.id === taskId ? controller.migration : existing?.id === taskId ? existing : null;
  const active = task?.status === "running";
  const dialogRef = useModalFocus(() => { if (!active) onClose(); });
  const terminal = task && ["completed", "restart_required"].includes(task.status);
  const resumable = task && ["interrupted", "cancelled", "failed"].includes(task.status);
  const progress = task?.bytesToCopy
    ? Math.min(100, Math.round((task.copiedBytes / task.bytesToCopy) * 100))
    : task?.status === "running" ? 40 : terminal ? 100 : 0;

  const choose = async () => {
    const selected = await controller.chooseMigrationDirectory();
    if (selected) {
      setDestination(selected);
      setTaskId(null);
    }
  };
  const inspect = async () => {
    const prepared = await controller.prepare(area, destination, mode);
    if (prepared) setTaskId(prepared.id);
  };

  return (
    <div className="storage-modal-scrim" role="presentation">
      <section ref={dialogRef} tabIndex={-1} className="storage-migration-dialog" role="dialog" aria-modal="true" aria-label={`迁移${areaLabels[area]}`}>
        <header><h2>迁移{areaLabels[area]}</h2><button type="button" aria-label="关闭迁移窗口" autoFocus disabled={active} onClick={onClose}>×</button></header>
        <div className="storage-migration-body">
          {!task ? (
            <>
              <p>{area === "app_data" ? "项目、字幕、观看记录、学习卡片和任务状态会整体复制。校验完成后，重启应用才会切换。" : area === "remote_media" ? "URL 导入的原视频会复制到新位置，全部校验通过后才更新项目路径。" : "播放缓存可以复制，也可以在新位置按需重新生成。"}</p>
              {area === "media_cache" ? (
                <fieldset className="storage-mode-choice">
                  <legend>处理现有缓存</legend>
                  <label><input type="radio" checked={mode === "copy"} onChange={() => setMode("copy")} />复制现有缓存</label>
                  <label><input type="radio" checked={mode === "rebuild"} onChange={() => setMode("rebuild")} />不复制，在新位置重新生成</label>
                </fieldset>
              ) : null}
              <label className="storage-path-field"><span>新的空文件夹</span><span><input value={destination} readOnly placeholder="选择目标文件夹" aria-label="新的存储位置" /><button className="button quiet" type="button" onClick={() => void choose()}>选择文件夹</button></span></label>
              <div className="storage-check-list"><span>目标必须可写且为空文件夹</span><span>迁移完成前不会删除旧目录</span><span>{area === "app_data" ? "SQLite 与文件哈希通过后才允许重启切换" : "逐文件 SHA-256 通过后才切换位置"}</span></div>
            </>
          ) : (
            <>
              <p>从 <strong>{task.sourceRoot}</strong> 迁移到 <strong>{task.destinationRoot}</strong></p>
              <div className="storage-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
              <div className="storage-progress-copy"><span>{active ? "正在复制并校验" : terminal ? "复制与校验已完成" : resumable ? "迁移已中断，可以继续" : "迁移计划已准备"}</span><strong>{progress}%</strong></div>
              <div className="storage-check-list">
                <span>预计处理 {formatBytes(task.bytesToCopy)}，{task.fileCount} 个文件</span>
                <span>已验证 {task.verifiedFileCount} 个文件</span>
                <span className={task.previousRootRetained ? "ok" : ""}>旧目录保留：{task.previousRootRetained ? "是" : "否"}</span>
              </div>
              {task.errorMessage ? <div className="storage-error">{task.errorMessage}</div> : null}
              {task.status === "restart_required" ? <div className="storage-notice"><strong>新目录已通过校验。</strong><span>重启后切换；确认运行正常前请保留旧目录。</span></div> : null}
            </>
          )}
          {controller.error ? <div className="storage-error">{controller.error}</div> : null}
        </div>
        <footer>
          <button className="button text" type="button" disabled={active} onClick={onClose}>{terminal ? "稍后处理" : "关闭"}</button>
          {!task ? <button className="button primary" type="button" disabled={!destination || controller.operation !== null} onClick={() => void inspect()}>检查迁移条件</button> : null}
          {task?.status === "prepared" ? <button className="button primary" type="button" disabled={controller.operation !== null} onClick={() => void controller.start()}>开始迁移</button> : null}
          {active ? <button className="button danger" type="button" disabled={controller.operation === "cancelling"} onClick={() => void controller.cancel()}>取消迁移</button> : null}
          {resumable ? <button className="button primary" type="button" disabled={controller.operation !== null} onClick={() => void controller.resume()}>继续迁移</button> : null}
          {task?.status === "restart_required" ? <button className="button primary" type="button" onClick={() => void controller.restart()}>重启并切换</button> : null}
        </footer>
      </section>
    </div>
  );
}

export function StoragePane({ controller }: StoragePaneProps) {
  const [dialogArea, setDialogArea] = useState<StorageArea | null>(null);
  const [confirmCacheClear, setConfirmCacheClear] = useState(false);
  const settings = controller.settings;

  if (!settings || controller.operation === "loading") {
    return <section className="storage-settings-pane"><div className="storage-settings-loading">正在读取存储位置…</div></section>;
  }

  const open = (kind: StorageLocationKind) => void controller.openLocation(kind);
  return (
    <>
      <section className="storage-settings-pane" aria-label="存储位置">
        <div className="storage-settings-scroll">
          <header className="storage-settings-heading"><div><h2>存储位置</h2><p>分别管理应用数据、媒体缓存和默认导出位置。</p></div><span className="storage-status-chip">已使用 {formatBytes(settings.appDataUsedBytes)}</span></header>
          <div className="storage-root-summary">
            <div><small>当前应用数据根目录</small><strong title={settings.appDataRoot}>{settings.appDataRoot}</strong></div>
            <div><span>已使用</span><b>{formatBytes(settings.appDataUsedBytes)}</b></div>
            <div><span>可用空间</span><b>{formatBytes(settings.appDataFreeSpaceBytes)}</b></div>
          </div>
          {controller.migration && ["running", "interrupted", "restart_required"].includes(controller.migration.status) ? <div className="storage-inline-confirm"><span>{areaLabels[controller.migration.area]}：{controller.migration.status === "running" ? "正在迁移" : controller.migration.status === "interrupted" ? "迁移已中断" : "等待重启切换"}</span><button className="button secondary" type="button" onClick={() => setDialogArea(controller.migration?.area ?? null)}>查看迁移</button></div> : null}

          <section className="storage-settings-section"><h3>核心数据</h3><div className="storage-settings-list">
            <StorageRow index={1} title="应用数据与数据库" helper="项目、字幕、观看记录、学习卡片和任务状态" path={settings.appDataRoot} size={settings.appDataUsedBytes} unavailable={!settings.appDataAvailable}>
              <button className="button quiet" type="button" onClick={() => open("app_data")}>打开位置</button>
              <button className="button secondary" type="button" disabled={settings.appDataRootLockedByEnvironment} title={settings.appDataRootLockedByEnvironment ? "位置由 SIAOVPLAY_DATA_DIR 锁定" : undefined} onClick={() => setDialogArea("app_data")}>迁移</button>
            </StorageRow>
            <StorageRow index={2} title="URL 导入视频" helper="从公开 URL 保存的原视频副本" path={settings.remoteMediaRoot} size={settings.remoteMediaUsedBytes} unavailable={!settings.remoteMediaAvailable}>
              <button className="button quiet" type="button" disabled={!settings.remoteMediaAvailable} onClick={() => open("remote_media")}>打开位置</button>
              <button className="button secondary" type="button" onClick={() => setDialogArea("remote_media")}>{settings.remoteMediaAvailable ? "更改" : "重新定位"}</button>
            </StorageRow>
          </div></section>

          <section className="storage-settings-section"><h3>可重新生成</h3><div className="storage-settings-list">
            <StorageRow index={3} title="播放缓存" helper="兼容播放版本与封面，可安全清理并重新生成" path={settings.mediaCacheRoot} size={settings.mediaCacheUsedBytes} unavailable={!settings.mediaCacheAvailable}>
              <button className="button quiet" type="button" onClick={() => setConfirmCacheClear(true)}>清理缓存</button>
              <button className="button secondary" type="button" onClick={() => setDialogArea("media_cache")}>更改</button>
            </StorageRow>
          </div></section>

          {confirmCacheClear ? <div className="storage-inline-confirm"><span>只删除代理视频与封面，原视频、字幕和项目记录不受影响。</span><button className="button text" type="button" onClick={() => setConfirmCacheClear(false)}>取消</button><button className="button danger" type="button" onClick={() => { setConfirmCacheClear(false); void controller.clearCache(); }}>确认清理</button></div> : null}

          <section className="storage-settings-section"><h3>默认导出位置</h3><div className="storage-settings-list">
            <StorageRow index={4} title="字幕" helper="SRT 或 WebVTT；导出时仍可临时改选" path={controller.subtitleDirectory ?? "每次询问"}>
              {controller.subtitleDirectory ? <button className="button quiet" type="button" disabled={controller.subtitleDirectory !== settings.defaultSubtitleExportDirectory} title={controller.subtitleDirectory !== settings.defaultSubtitleExportDirectory ? "应用设置后可打开新位置" : undefined} onClick={() => open("subtitle_export")}>打开位置</button> : null}
              <button className="button secondary" type="button" onClick={() => void controller.chooseDefault("subtitle")}>{controller.subtitleDirectory ? "更改" : "选择默认位置"}</button>
            </StorageRow>
            <StorageRow index={5} title="视频与分析报告" helper="烧录 MP4、Markdown 报告和报告素材" path={controller.reportDirectory ?? "每次询问"}>
              {controller.reportDirectory ? <button className="button quiet" type="button" disabled={controller.reportDirectory !== settings.defaultVideoReportExportDirectory} title={controller.reportDirectory !== settings.defaultVideoReportExportDirectory ? "应用设置后可打开新位置" : undefined} onClick={() => open("video_report_export")}>打开位置</button> : null}
              <button className="button secondary" type="button" onClick={() => void controller.chooseDefault("report")}>{controller.reportDirectory ? "更改" : "选择默认位置"}</button>
            </StorageRow>
          </div></section>
          {settings.pendingAppDataRoot ? <div className="storage-notice"><strong>等待重启切换。</strong><span>新应用数据位置：{settings.pendingAppDataRoot}</span></div> : <div className="storage-notice"><strong>核心数据迁移会保留旧目录。</strong><span>新位置验证正常后，再手动清理旧数据。</span></div>}
          {controller.error ? <div className="storage-error">{controller.error}</div> : null}
        </div>
      </section>
      {dialogArea ? <MigrationDialog area={dialogArea} controller={controller} onClose={() => setDialogArea(null)} /> : null}
    </>
  );
}
