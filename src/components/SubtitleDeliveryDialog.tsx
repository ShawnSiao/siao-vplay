import { useDeliverySubmission, type DeliveryOperation } from "../features/subtitle-delivery/useDeliverySubmission";
import { useBurnPolling } from "../features/subtitle-delivery/useBurnPolling";
import type { SubtitleVersionMetadata } from "../features/subtitle-revision/subtitleMetadata";
import { useEffect, useMemo, useState } from "react";

import {
  cancelSubtitleBurnJob,
  commandError,
  getSubtitleBurnJob,
  listSubtitleBurnJobs,
  resumeSubtitleBurnJob,
} from "../lib/desktop";
import type {
  Project,
  SubtitleBurnJob,
  SubtitleExport,
  SubtitleExportFormat,
  SubtitleExportMode,
  SubtitleVersion,
} from "../types";
import { Dialog } from "./Dialog";
import { versionLabel, jobStatusLabel } from "../features/subtitle-delivery/deliveryLabels";
import { SubtitleHistoryPager } from "../features/subtitle-revision/SubtitleHistoryPager";
import type { HistoryPagination } from "../features/subtitle-revision/useSubtitleHistoryPages";

type SubtitleDeliveryDialogProps = {
  project: Project;
  versions: SubtitleVersionMetadata[];
  historyPagination?: HistoryPagination;
  currentSubtitle: SubtitleVersion | null;
  currentTranslation: SubtitleVersion | null;
  onClose: () => void;
};

type OutputKind = "subtitle" | "video";

const activeStatuses = new Set(["queued", "running", "validating"]);
const retryableStatuses = new Set(["failed", "cancelled", "interrupted"]);

export function SubtitleDeliveryDialog({
  project,
  versions,
  historyPagination,
  currentSubtitle,
  currentTranslation,
  onClose,
}: SubtitleDeliveryDialogProps) {
  const [retainedVersions, setRetainedVersions] = useState(() => [
    versions.find(version => version.id === currentSubtitle?.id) ?? versions.find(version => version.role === "original"),
    versions.find(version => version.id === currentTranslation?.id) ?? versions.find(version => version.role === "translation"),
  ].filter((version): version is SubtitleVersionMetadata => Boolean(version)));
  const availableVersions = useMemo(() => [...new Map([
    ...retainedVersions.map(version => ({ ...version, isCurrent: versions.some(item => item.id === version.id && item.isCurrent) })),
    ...versions,
  ].map(version => [version.id, version])).values()], [retainedVersions, versions]);
  const retainVersion = (id: string) => {
    const version = availableVersions.find(item => item.id === id);
    if (version) setRetainedVersions(current => [...current.filter(item => item.role !== version.role), version]);
  };
  const sourceVersions = useMemo(
    () => availableVersions.filter((version) => version.role === "original"),
    [availableVersions],
  );
  const translationVersions = useMemo(
    () => availableVersions.filter((version) => version.role === "translation"),
    [availableVersions],
  );
  const [outputKind, setOutputKind] = useState<OutputKind>("subtitle");
  const [mode, setMode] = useState<SubtitleExportMode>(
    currentTranslation ? "translation" : "original",
  );
  const [format, setFormat] = useState<SubtitleExportFormat>("srt");
  const [sourceVersionId, setSourceVersionId] = useState(
    currentSubtitle?.id ?? sourceVersions[0]?.id ?? "",
  );
  const [translationVersionId, setTranslationVersionId] = useState(
    currentTranslation?.id ?? translationVersions[0]?.id ?? "",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [operation, setOperation] = useState<DeliveryOperation>("loading");
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<SubtitleExport | null>(null);
  const [job, setJob] = useState<SubtitleBurnJob | null>(null);
  const [recentJob, setRecentJob] = useState<SubtitleBurnJob | null>(null);
  const [pollFailure, setPollFailure] = useState<{ jobId: string; projectId: string; message: string } | null>(null);
  const jobError = error ?? (pollFailure?.jobId === job?.id && pollFailure?.projectId === project.id && job && activeStatuses.has(job.status)
    ? pollFailure.message : null);

  useEffect(() => {
    let active = true;
    void listSubtitleBurnJobs(project.id)
      .then((jobs) => {
        if (!active) return;
        const latest = jobs[0] ?? null;
        setRecentJob(latest);
        if (latest && activeStatuses.has(latest.status)) {
          setJob(latest);
        }
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(commandError(caught).message);
        }
      })
      .finally(() => {
        if (active) {
          setOperation(null);
        }
      });
    return () => {
      active = false;
    };
  }, [project.id]);

  useBurnPolling({ projectId: project.id, task: job, read: getSubtitleBurnJob,
    onTask: nextJob => {
      const acceptPoll = (current: SubtitleBurnJob | null) => {
        if (!current || current.id !== nextJob.id || current.projectId !== nextJob.projectId || !activeStatuses.has(current.status)) return current;
        if (current.stage === "cancelling" && nextJob.stage !== "cancelling" && activeStatuses.has(nextJob.status)) return current;
        return nextJob;
      };
      setJob(acceptPoll); setRecentJob(acceptPoll); setPollFailure(null);
    },
    onError: caught => { if (job) setPollFailure({ jobId: job.id, projectId: project.id, message: commandError(caught).message }); } });

  const needsSource = mode === "original" || mode === "bilingual";
  const needsTranslation = mode === "translation" || mode === "bilingual";
  const canSubmit =
    confirmed &&
    (!needsSource || Boolean(sourceVersionId)) &&
    (!needsTranslation || Boolean(translationVersionId)) &&
    operation === null;

  const submission = useDeliverySubmission({ projectId: project.id, outputKind, mode, format,
    sourceVersionId, translationVersionId, canSubmit, onOperation: setOperation,
    onError: setError, onExported: setExported,
    onJob: nextJob => { setJob(nextJob); setRecentJob(nextJob); } });
  const closeDelivery = () => { submission.invalidate(); onClose(); };

  const cancelJob = async () => {
    if (!job || !activeStatuses.has(job.status)) return;
    setOperation("cancelling");
    setError(null);
    try {
      const nextJob = await cancelSubtitleBurnJob(job.id);
      setJob(nextJob);
      setRecentJob(nextJob);
    } catch (caught) {
      setError(commandError(caught).message);
    } finally {
      setOperation(null);
    }
  };

  const resumeJob = async () => {
    if (!job || !retryableStatuses.has(job.status)) return;
    setOperation("resuming");
    setError(null);
    try {
      const nextJob = await resumeSubtitleBurnJob(job.id);
      setJob(nextJob);
      setRecentJob(nextJob);
    } catch (caught) {
      setError(commandError(caught).message);
    } finally {
      setOperation(null);
    }
  };

  if (job) {
    const active = activeStatuses.has(job.status);
    const retryable = retryableStatuses.has(job.status);
    return (
      <Dialog
        key={`${job.id}:${active ? "active" : "settled"}`}
        title={jobStatusLabel(job)}
        eyebrow="字幕烧录 · 后台任务"
        onClose={closeDelivery}
        actions={
          <>
            {active ? (
              <button
                className="button danger"
                disabled={operation !== null || job.stage === "cancelling"}
                type="button"
                onClick={() => void cancelJob()}
              >
                {operation === "cancelling" || job.stage === "cancelling" ? "正在取消…" : "取消烧录"}
              </button>
            ) : null}
            {retryable ? (
              <button
                className="button primary"
                disabled={operation !== null}
                type="button"
                onClick={() => void resumeJob()}
              >
                {operation === "resuming" ? "正在重新开始…" : "重新开始"}
              </button>
            ) : null}
            {!active ? (
              <button
                className="button quiet"
                type="button"
                onClick={() => {
                  setJob(null);
                  setConfirmed(false);
                }}
              >
                继续导出
              </button>
            ) : null}
            <button className="button quiet" type="button" onClick={closeDelivery}>
              {active ? "返回观影" : "关闭"}
            </button>
          </>
        }
      >
        <div className="delivery-dialog delivery-job" aria-live="polite">
          <div className="delivery-job-heading">
            <span>
              <strong>
                {job.mode === "bilingual" ? "烧录双语字幕" : "烧录翻译字幕"}
              </strong>
              <small>
                {active ? "关闭窗口不会停止任务。" : `FFmpeg ${job.runtimeVersion}`}
              </small>
            </span>
            <em>{Math.round(job.progress * 100)}%</em>
          </div>
          <div
            className="delivery-progress"
            role="progressbar"
            aria-label="字幕烧录进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(job.progress * 100)}
          >
            <span style={{ width: `${Math.round(job.progress * 100)}%` }}></span>
          </div>
          {job.outputPath ? (
            <div className="delivery-result">
              <strong>新视频已生成</strong>
              <span className="delivery-path">{job.outputPath}</span>
              <small>源视频和字幕版本没有改变，清单保存在视频旁。</small>
            </div>
          ) : null}
          {job.errorMessage ? (
            <div className="notice danger delivery-error">
              <strong>{jobStatusLabel(job)}</strong>
              <p>{job.errorMessage}</p>
            </div>
          ) : null}
          {jobError ? (
            <div className="notice danger delivery-error">
              <strong>操作失败</strong>
              <p>{jobError}</p>
            </div>
          ) : null}
        </div>
      </Dialog>
    );
  }

  if (exported) {
    return (
      <Dialog
        key="subtitle-exported"
        title="字幕已导出"
        eyebrow="版本与文件指纹已记录"
        onClose={closeDelivery}
        actions={
          <>
            <button
              className="button quiet"
              type="button"
              onClick={() => {
                setExported(null);
                setConfirmed(false);
              }}
            >
              继续导出
            </button>
            <button className="button primary" type="button" onClick={closeDelivery}>
              完成
            </button>
          </>
        }
      >
        <div className="delivery-dialog delivery-result">
          <strong>
            {exported.mode === "bilingual"
              ? "双语字幕"
              : exported.mode === "translation"
                ? "翻译字幕"
                : "原文字幕"}
            {" · "}
            {exported.format.toUpperCase()}
          </strong>
          <span className="delivery-path">{exported.filePath}</span>
          <small>
            共 {exported.cueCount} 条字幕；版本 ID、媒体指纹和文件 SHA-256
            已写入旁边的清单。
          </small>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      key="delivery-form"
      title="导出与烧录"
      eyebrow="使用明确的字幕版本"
      onClose={closeDelivery}
      actions={
        <>
          <button className="button quiet" type="button" onClick={closeDelivery}>
            取消
          </button>
          <button
            className="button primary"
            disabled={!canSubmit}
            type="button"
            onClick={() => void submission.submit()}
          >
            {operation === "selecting" ? "正在选择保存位置…" : operation === "exporting"
              ? "正在导出…"
              : operation === "starting"
                ? "正在创建任务…"
                : outputKind === "video"
                  ? "选择位置并开始烧录"
                  : "选择位置并导出"}
          </button>
        </>
      }
    >
      <div className="delivery-dialog" inert={submission.pending}>
        <p className="delivery-copy">
          字幕文件会附带版本清单。烧录会生成新视频，不修改源视频；解释和学习卡片不会写入。
        </p>

        <div className="delivery-kind-tabs" aria-label="交付类型">
          <button
            className={outputKind === "subtitle" ? "active" : ""}
            type="button"
            onClick={() => {
              setOutputKind("subtitle");
              setConfirmed(false);
            }}
          >
            <strong>字幕文件</strong>
            <small>SRT 或 WebVTT</small>
          </button>
          <button
            className={outputKind === "video" ? "active" : ""}
            type="button"
            disabled={!translationVersions.length}
            onClick={() => {
              setOutputKind("video");
              if (mode === "original") {
                setMode("translation");
              }
              setConfirmed(false);
            }}
          >
            <strong>烧录视频</strong>
            <small>生成新的 MP4</small>
          </button>
        </div>

        <section className="delivery-section">
          <h3>字幕内容</h3>
          <div className="delivery-mode-grid">
            {(
              [
                ["original", "原文", Boolean(sourceVersions.length)],
                ["translation", "翻译字幕", Boolean(translationVersions.length)],
                [
                  "bilingual",
                  "双语",
                  Boolean(sourceVersions.length && translationVersions.length),
                ],
              ] as const
            ).map(([value, label, available]) => (
              <button
                aria-pressed={mode === value}
                className={mode === value ? "selected" : ""}
                disabled={!available || (outputKind === "video" && value === "original")}
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setConfirmed(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <SubtitleHistoryPager page={historyPagination} />
        <section className="delivery-section delivery-version-grid">
          {needsSource ? (
            <label>
              <span>原文字幕版本</span>
              <select
                aria-label="原文字幕版本"
                value={sourceVersionId}
                onChange={(event) => {
                  setSourceVersionId(event.target.value);
                  retainVersion(event.target.value);
                  setConfirmed(false);
                }}
              >
                {sourceVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionLabel(version)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {needsTranslation ? (
            <label>
              <span>目标语言字幕版本</span>
              <select
                aria-label="目标语言字幕版本"
                value={translationVersionId}
                onChange={(event) => {
                  setTranslationVersionId(event.target.value);
                  retainVersion(event.target.value);
                  setConfirmed(false);
                }}
              >
                {translationVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionLabel(version)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {outputKind === "subtitle" ? (
            <label>
              <span>文件格式</span>
              <select
                aria-label="字幕文件格式"
                value={format}
                onChange={(event) => {
                  setFormat(event.target.value as SubtitleExportFormat);
                  setConfirmed(false);
                }}
              >
                <option value="srt">SRT</option>
                <option value="vtt">WebVTT</option>
              </select>
            </label>
          ) : (
            <div className="delivery-fixed-format">
              <span>视频格式</span>
              <strong>MP4 · H.264 / AAC</strong>
            </div>
          )}
        </section>

        <label className="delivery-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>确认使用以上字幕版本；导出或烧录不会静默切换到其他版本。</span>
        </label>

        {recentJob ? (
          <button
            className="delivery-recent-job"
            type="button"
            onClick={() => setJob(recentJob)}
          >
            <span>
              <strong>最近一次烧录</strong>
              <small>{jobStatusLabel(recentJob)}</small>
            </span>
            <em>{retryableStatuses.has(recentJob.status) ? "查看并重试" : "查看"}</em>
          </button>
        ) : null}

        {operation === "loading" ? (
          <p className="delivery-loading">正在读取本地任务…</p>
        ) : null}
        {error ? (
          <div className="notice danger delivery-error">
            <strong>无法完成操作</strong>
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
