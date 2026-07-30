import { useEffect, useMemo, useState } from "react";

import {
  cancelSubtitleBurnJob,
  chooseSubtitleDeliveryDirectory,
  commandError,
  exportSubtitles,
  getSubtitleBurnJob,
  listSubtitleBurnJobs,
  resumeSubtitleBurnJob,
  startSubtitleBurn,
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

type SubtitleDeliveryDialogProps = {
  project: Project;
  versions: SubtitleVersion[];
  currentSubtitle: SubtitleVersion | null;
  currentTranslation: SubtitleVersion | null;
  onClose: () => void;
};

type OutputKind = "subtitle" | "video";

const activeStatuses = new Set(["queued", "running", "validating"]);
const retryableStatuses = new Set(["failed", "cancelled", "interrupted"]);

function versionLabel(version: SubtitleVersion) {
  const role = version.role === "original" ? "原文" : "简体中文";
  const current = version.isCurrent ? " · 当前" : "";
  const status = version.status === "draft" ? " · 草稿" : "";
  return `${role} · 版本 ${version.versionNumber}${current}${status}`;
}

function jobStatusLabel(job: SubtitleBurnJob) {
  if (job.status === "queued") return "等待开始";
  if (job.status === "running") return "正在烧录";
  if (job.status === "validating") return "正在检查视频";
  if (job.status === "completed") return "烧录已完成";
  if (job.status === "interrupted") return "上次任务已中断";
  if (job.status === "cancelled") return "任务已取消";
  return "烧录失败";
}

export function SubtitleDeliveryDialog({
  project,
  versions,
  currentSubtitle,
  currentTranslation,
  onClose,
}: SubtitleDeliveryDialogProps) {
  const sourceVersions = useMemo(
    () => versions.filter((version) => version.role === "original"),
    [versions],
  );
  const translationVersions = useMemo(
    () =>
      versions.filter(
        (version) =>
          version.role === "translation" &&
          version.languageCode.toLowerCase() === "zh-cn",
      ),
    [versions],
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
  const [operation, setOperation] = useState<
    "loading" | "exporting" | "starting" | "cancelling" | "resuming" | null
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<SubtitleExport | null>(null);
  const [job, setJob] = useState<SubtitleBurnJob | null>(null);
  const [recentJob, setRecentJob] = useState<SubtitleBurnJob | null>(null);
  const activeJobId =
    job && activeStatuses.has(job.status) ? job.id : undefined;

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

  useEffect(() => {
    if (!activeJobId) {
      return undefined;
    }
    let active = true;
    const timer = window.setInterval(() => {
      void getSubtitleBurnJob(activeJobId)
        .then((nextJob) => {
          if (!active) return;
          setJob(nextJob);
          setRecentJob(nextJob);
        })
        .catch((caught: unknown) => {
          if (active) {
            setError(commandError(caught).message);
          }
        });
    }, 500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeJobId]);

  const needsSource = mode === "original" || mode === "bilingual";
  const needsTranslation = mode === "translation" || mode === "bilingual";
  const canSubmit =
    confirmed &&
    (!needsSource || Boolean(sourceVersionId)) &&
    (!needsTranslation || Boolean(translationVersionId)) &&
    operation === null;

  const createDelivery = async () => {
    if (!canSubmit) return;
    setError(null);
    let destination: string | null;
    try {
      destination = await chooseSubtitleDeliveryDirectory();
    } catch (caught) {
      setError(commandError(caught).message);
      return;
    }
    if (!destination) return;
    if (outputKind === "subtitle") {
      setOperation("exporting");
      try {
        const result = await exportSubtitles(
          project.id,
          mode,
          format,
          needsSource ? sourceVersionId : null,
          needsTranslation ? translationVersionId : null,
          destination,
        );
        setExported(result);
      } catch (caught) {
        setError(commandError(caught).message);
      } finally {
        setOperation(null);
      }
      return;
    }

    if (!translationVersionId) return;
    setOperation("starting");
    try {
      const nextJob = await startSubtitleBurn(
        project.id,
        mode === "bilingual" ? "bilingual" : "translation",
        mode === "bilingual" ? sourceVersionId : null,
        translationVersionId,
        destination,
      );
      setJob(nextJob);
      setRecentJob(nextJob);
    } catch (caught) {
      setError(commandError(caught).message);
    } finally {
      setOperation(null);
    }
  };

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
        onClose={onClose}
        actions={
          <>
            {active ? (
              <button
                className="button danger"
                disabled={operation !== null}
                type="button"
                onClick={() => void cancelJob()}
              >
                {operation === "cancelling" ? "正在取消…" : "取消烧录"}
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
            <button className="button quiet" type="button" onClick={onClose}>
              {active ? "返回观影" : "关闭"}
            </button>
          </>
        }
      >
        <div className="delivery-dialog delivery-job" aria-live="polite">
          <div className="delivery-job-heading">
            <span>
              <strong>
                {job.mode === "bilingual" ? "烧录双语字幕" : "烧录中文字幕"}
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
          {error ? (
            <div className="notice danger delivery-error">
              <strong>操作失败</strong>
              <p>{error}</p>
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
        onClose={onClose}
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
            <button className="button primary" type="button" onClick={onClose}>
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
                ? "简体中文字幕"
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
      onClose={onClose}
      actions={
        <>
          <button className="button quiet" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            disabled={!canSubmit}
            type="button"
            onClick={() => void createDelivery()}
          >
            {operation === "exporting"
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
      <div className="delivery-dialog">
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
                ["translation", "简体中文", Boolean(translationVersions.length)],
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

        <section className="delivery-section delivery-version-grid">
          {needsSource ? (
            <label>
              <span>原文字幕版本</span>
              <select
                aria-label="原文字幕版本"
                value={sourceVersionId}
                onChange={(event) => {
                  setSourceVersionId(event.target.value);
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
              <span>简体中文字幕版本</span>
              <select
                aria-label="简体中文字幕版本"
                value={translationVersionId}
                onChange={(event) => {
                  setTranslationVersionId(event.target.value);
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
