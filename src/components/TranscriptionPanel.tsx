import { useEffect, useRef, useState } from "react";

import {
  cancelTranscriptionJob,
  commandError,
  getTranscriptionJob,
  getTranscriptionRuntimeStatus,
  listSubtitleVersions,
  listTranscriptionJobs,
  resumeTranscriptionJob,
  startTranscription,
} from "../lib/desktop";
import type {
  SubtitleVersion,
  TranscriptionJob,
  TranscriptionRuntimeStatus,
} from "../types";

type TranscriptionPanelProps = {
  projectId: string;
  currentVersion: SubtitleVersion | null;
  onJobTracked: (jobId: string) => void;
  onVersionReady: (version: SubtitleVersion) => void;
};

const languageOptions = [
  ["auto", "自动识别（混合讲解）"],
  ["en", "英语"],
  ["th", "泰语"],
  ["ja", "日语"],
  ["ko", "韩语"],
] as const;

const activeStatuses = new Set<TranscriptionJob["status"]>([
  "queued",
  "extracting",
  "transcribing",
  "validating",
]);

function stageLabel(job: TranscriptionJob): string {
  if (job.stage === "cancelling") {
    return "正在安全停止";
  }
  if (job.status === "queued") {
    return "等待开始";
  }
  if (job.status === "extracting") {
    return "正在准备音轨";
  }
  if (job.status === "transcribing") {
    return "正在识别语音";
  }
  if (job.status === "validating") {
    return "正在检查字幕";
  }
  if (job.status === "completed") {
    return "原文字幕草稿已生成";
  }
  if (job.status === "cancelled") {
    return "任务已取消";
  }
  if (job.status === "interrupted") {
    return "上次任务意外中断";
  }
  return "这次生成没有完成";
}

function jobFailureMessage(job: TranscriptionJob): string {
  switch (job.errorCode) {
    case "source_changed":
      return "视频或项目内容已发生变化，请关闭窗口后重新开始。";
    case "runtime_unavailable":
    case "runtime_integrity":
      return "本地语音组件不可用，请检查应用运行环境后重试。";
    case "model_unavailable":
    case "model_integrity":
      return "所选识别资源不可用，可以改用另一种识别模式。";
    case "missing_audio":
      return "这段视频没有可识别的音轨。";
    case "invalid_output":
      return job.errorMessage ?? "语音结果没有通过时间轴或置信度检查，项目内容保持不变。";
    case "cancelled":
      return "临时音频和识别文件已经清理。";
    case "app_interrupted":
      return "应用退出时任务尚未完成，可以从头重新开始。";
    default:
      return "项目内容保持不变，可以重新开始。";
  }
}

function userFacingError(error: unknown): string {
  const failure = commandError(error);
  switch (failure.code) {
    case "transcription_runtime_unavailable":
    case "transcription_runtime_invalid":
      return "本地语音组件尚未准备好。";
    case "transcription_model_unavailable":
    case "transcription_model_invalid":
      return "所选识别资源尚未准备好。";
    case "missing_audio_stream":
      return "这段视频没有可识别的音轨。";
    case "project_changed":
      return "视频或字幕已经发生变化，请重新打开字幕准备。";
    case "transcription_already_running":
      return "这个项目已有正在进行的字幕生成任务。";
    case "subtitle_replace_confirmation_required":
      return "需要先确认保留旧版本并生成新的当前草稿。";
    default:
      return failure.message;
  }
}

export function TranscriptionPanel({
  projectId,
  currentVersion,
  onJobTracked,
  onVersionReady,
}: TranscriptionPanelProps) {
  const reportedVersionRef = useRef<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] =
    useState<TranscriptionRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [language, setLanguage] =
    useState<(typeof languageOptions)[number][0] | "">("");
  const [modelKind, setModelKind] = useState<"small" | "base">("small");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [operation, setOperation] = useState<
    "start" | "cancel" | "resume" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getTranscriptionRuntimeStatus(),
      listTranscriptionJobs(projectId),
    ])
      .then(([status, jobs]) => {
        if (!active) {
          return;
        }
        setRuntimeStatus(status);
        const unfinished =
          jobs.find((item) => activeStatuses.has(item.status)) ??
          jobs.find((item) =>
            ["failed", "interrupted", "cancelled"].includes(item.status),
          ) ??
          (!currentVersion
            ? jobs.find(
                (item) =>
                  item.status === "completed" &&
                  item.subtitleVersionId !== null,
              )
            : undefined);
        if (unfinished) {
          setJob(unfinished);
          setLanguage(
            languageOptions.some(([value]) => value === unfinished.languageCode)
              ? unfinished.languageCode
              : "",
          );
          setModelKind(unfinished.modelKind);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(userFacingError(cause));
        }
      })
      .finally(() => {
        if (active) {
          setRuntimeLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [currentVersion, projectId]);

  useEffect(() => {
    if (job && activeStatuses.has(job.status)) {
      onJobTracked(job.id);
    }
  }, [job, onJobTracked]);

  useEffect(() => {
    if (!job || !activeStatuses.has(job.status)) {
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void getTranscriptionJob(job.id)
        .then((nextJob) => {
          if (active) {
            setJob(nextJob);
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setError(userFacingError(cause));
          }
        });
    }, 900);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [job]);

  useEffect(() => {
    const versionId = job?.subtitleVersionId;
    if (
      job?.status !== "completed" ||
      !versionId ||
      reportedVersionRef.current === versionId
    ) {
      return;
    }
    reportedVersionRef.current = versionId;
    void listSubtitleVersions(projectId)
      .then((versions) => {
        const version = versions.find((item) => item.id === versionId);
        if (!version) {
          throw new Error("生成的字幕版本暂时无法读取");
        }
        onVersionReady(version);
      })
      .catch((cause: unknown) => {
        reportedVersionRef.current = null;
        setError(userFacingError(cause));
      });
  }, [job, onVersionReady, projectId]);

  const selectedModel = runtimeStatus?.models.find(
    (model) => model.modelKind === modelKind,
  );
  const canStart =
    !runtimeLoading &&
    runtimeStatus?.available === true &&
    selectedModel?.available === true &&
    language !== "" &&
    (!currentVersion || replaceConfirmed);
  const activeJob = job ? activeStatuses.has(job.status) : false;
  const canResume =
    job && ["failed", "interrupted", "cancelled"].includes(job.status);

  const begin = async () => {
    if (!canStart || !language) {
      return;
    }
    setOperation("start");
    setError(null);
    try {
      const nextJob = await startTranscription(
        projectId,
        language,
        modelKind,
        Boolean(currentVersion),
      );
      setJob(nextJob);
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setOperation(null);
    }
  };

  const cancel = async () => {
    if (!job) {
      return;
    }
    setOperation("cancel");
    setError(null);
    try {
      setJob(await cancelTranscriptionJob(job.id));
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setOperation(null);
    }
  };

  const resume = async () => {
    if (!job) {
      return;
    }
    setOperation("resume");
    setError(null);
    try {
      setJob(await resumeTranscriptionJob(job.id));
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setOperation(null);
    }
  };

  if (runtimeLoading) {
    return (
      <div className="transcription-loading" role="status">
        <span className="spinner"></span>
        <span>正在检查本地语音能力…</span>
      </div>
    );
  }

  if (job) {
    const percentage = Math.round(job.progress * 100);
    return (
      <section className="transcription-task" aria-live="polite">
        <div className="transcription-task-head">
          <div>
            <span>生成原文字幕</span>
            <strong>{stageLabel(job)}</strong>
          </div>
          <span className={`status-pill ${activeJob ? "warning" : "ready"}`}>
            {activeJob ? `${percentage}%` : job.status === "completed" ? "完成" : "已停止"}
          </span>
        </div>
        <div
          className="transcription-progress"
          role="progressbar"
          aria-label="原文字幕生成进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        >
          <span style={{ width: `${percentage}%` }}></span>
        </div>
        <dl className="transcription-summary">
          <div>
            <dt>语言</dt>
            <dd>
              {languageOptions.find(([value]) => value === job.languageCode)?.[1] ??
                job.languageCode.toUpperCase()}
            </dd>
          </div>
          <div>
            <dt>识别模式</dt>
            <dd>{job.modelKind === "small" ? "标准" : "轻量"}</dd>
          </div>
          <div>
            <dt>数据位置</dt>
            <dd>仅本机</dd>
          </div>
        </dl>
        {activeJob ? (
          <>
            <p className="transcription-note">
              可以关闭窗口继续观看；任务状态会保存在项目中。退出应用后可重新开始。
            </p>
            <button
              className="button quiet"
              type="button"
              disabled={operation !== null}
              onClick={() => void cancel()}
            >
              {operation === "cancel" ? "正在停止…" : "取消生成"}
            </button>
          </>
        ) : null}
        {job.status === "completed" ? (
          <div className="notice transcription-success">
            <strong>已生成原文字幕草稿</strong>
            <p>字幕已经过时间轴检查，可回到播放器抽查内容。</p>
          </div>
        ) : null}
        {canResume ? (
          <div className="notice danger transcription-failure">
            <strong>项目内容保持不变</strong>
            <p>{jobFailureMessage(job)}</p>
            <button
              className="button"
              type="button"
              disabled={operation !== null}
              onClick={() => void resume()}
            >
              {operation === "resume" ? "正在重新开始…" : "重新开始"}
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="notice danger transcription-error" role="alert">
            <strong>字幕生成未继续</strong>
            <p>{error}</p>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="transcription-setup">
      <div className="transcription-local-note">
        <span className="status-dot"></span>
        <div>
          <strong>语音识别只在本机运行</strong>
          <p>视频不会上传。支持英、泰、日、韩，也可自动识别中文讲解为主的混合教程。</p>
        </div>
      </div>

      {!runtimeStatus?.available ? (
        <div className="notice danger" role="alert">
          <strong>本地语音能力尚未就绪</strong>
          <p>需要先准备应用随附的语音组件和至少一种识别资源。</p>
        </div>
      ) : null}

      <label className="subtitle-language-field">
        <span>视频原声语言</span>
        <select
          value={language}
          disabled={operation !== null}
          onChange={(event) => {
            setLanguage(
              event.target.value as
                | (typeof languageOptions)[number][0]
                | "",
            );
            setError(null);
          }}
        >
          <option value="">选择识别方式</option>
          {languageOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <small>
          混合讲解选「自动识别」；单一原声选择固定语言更稳定。
        </small>
      </label>

      <fieldset className="transcription-models">
        <legend>识别模式</legend>
        {(["small", "base"] as const).map((kind) => {
          const available = runtimeStatus?.models.find(
            (model) => model.modelKind === kind,
          )?.available;
          return (
            <label key={kind} className={!available ? "disabled" : ""}>
              <input
                type="radio"
                name="transcription-model"
                value={kind}
                checked={modelKind === kind}
                disabled={!available || operation !== null}
                onChange={() => setModelKind(kind)}
              />
              <span>
                <strong>
                  {kind === "small" ? "标准识别（推荐）" : "轻量识别"}
                </strong>
                <small>
                  {kind === "small"
                    ? "更适合人名、称谓和小语种对白"
                    : "占用更少空间，准确度可能下降"}
                </small>
              </span>
              {!available ? <em>未准备</em> : null}
            </label>
          );
        })}
      </fieldset>

      {currentVersion ? (
        <label className="transcription-replace-confirm">
          <input
            type="checkbox"
            checked={replaceConfirmed}
            onChange={(event) => setReplaceConfirmed(event.target.checked)}
          />
          <span>
            生成后把新草稿设为当前原文字幕。现有版本会保留，不会被删除。
          </span>
        </label>
      ) : null}

      <button
        className="button primary transcription-start"
        type="button"
        disabled={!canStart || operation !== null}
        onClick={() => void begin()}
      >
        {operation === "start" ? "正在建立任务…" : "生成原文字幕"}
      </button>

      {error ? (
        <div className="notice danger transcription-error" role="alert">
          <strong>无法开始生成</strong>
          <p>{error}</p>
        </div>
      ) : null}
    </section>
  );
}
