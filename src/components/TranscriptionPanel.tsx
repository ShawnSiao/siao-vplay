import { useTranscriptionResult } from "../features/transcription/useTranscriptionResult";
import { useTaskPolling, taskPollingIntervals } from "../features/ai-tasks/useTaskPolling";
import { useEffect, useState } from "react";

import {
  cancelTranscriptionJob,
  commandError,
  getTranscriptionJob,
  getTranscriptionRuntimeStatus,
  getSubtitleVersion,
  listTranscriptionJobs,
  resumeTranscriptionJob,
  startTranscription,
} from "../lib/desktop";
import type {
  LocalResourceCatalog,
  LocalResourceStatus,
  SubtitleVersion,
  TranscriptionJob,
  TranscriptionRuntimeStatus,
} from "../types";

type TranscriptionPanelProps = {
  projectId: string;
  currentVersion: SubtitleVersion | null;
  onJobTracked: (jobId: string) => void;
  onVersionReady: (version: SubtitleVersion) => void;
  localResourceCatalog?: LocalResourceCatalog | null;
  localResourceStatus?: LocalResourceStatus | null;
  onPrepareResources?: (profileId: "fast" | "standard") => Promise<void> | void;
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

const shouldPollTranscription = (job: TranscriptionJob) => activeStatuses.has(job.status);

const profileOptions = [
  { id: "standard", modelKind: "small", title: "标准识别（推荐）" },
  { id: "fast", modelKind: "base", title: "快速识别" },
] as const;

function modelKindForProfile(profileId: "fast" | "standard"): "small" | "base" {
  return profileId === "standard" ? "small" : "base";
}

function profileForModelKind(modelKind: "small" | "base"): "fast" | "standard" {
  return modelKind === "small" ? "standard" : "fast";
}

function formatDownloadBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes >= 100_000_000 ? 0 : 1)} MB`;
}

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
  localResourceCatalog,
  localResourceStatus,
  onPrepareResources,
}: TranscriptionPanelProps) {
  const [runtimeStatus, setRuntimeStatus] =
    useState<TranscriptionRuntimeStatus | null>(null);
  const [runtimeCheckedKey, setRuntimeCheckedKey] = useState<string | null>(null);
  const [language, setLanguage] =
    useState<(typeof languageOptions)[number][0] | "">("");
  const [profileId, setProfileId] = useState<"fast" | "standard">(
    localResourceStatus?.preferredProfile === "fast" ? "fast" : "standard",
  );
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [storedJob, setJob] = useState<TranscriptionJob | null>(null);
  const job = storedJob?.projectId === projectId ? storedJob : null;
  const [operation, setOperation] = useState<
    "start" | "cancel" | "resume" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const [checkAttempt, setCheckAttempt] = useState(0);
  const [jobsCheckedKey, setJobsCheckedKey] = useState<string | null>(null);
  const checkKey = JSON.stringify([projectId, currentVersion?.id ?? null, localResourceStatus?.preferredProfile, checkAttempt]);
  const runtimeLoading = runtimeCheckedKey !== checkKey;
  const jobsLoading = jobsCheckedKey !== checkKey;
  const [runtimeReadError, setRuntimeReadError] = useState<string | null>(null);
  const [jobsReadError, setJobsReadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getTranscriptionRuntimeStatus().then(status => {
      if (active) { setRuntimeStatus(status); setRuntimeReadError(null); }
    }).catch((cause: unknown) => {
      if (active) { setRuntimeStatus(null); setRuntimeReadError(userFacingError(cause)); }
    }).finally(() => { if (active) setRuntimeCheckedKey(checkKey); });
    void listTranscriptionJobs(projectId).then(jobs => {
      if (!active) return;
      setJobsReadError(null);
      const unfinished = jobs.find(item => activeStatuses.has(item.status)) ??
        jobs.find(item => ["failed", "interrupted", "cancelled"].includes(item.status)) ??
        (!currentVersion ? jobs.find(item => item.status === "completed" && item.subtitleVersionId !== null) : undefined);
      // A refresh must not replace a newer command or polling result already owned by this panel.
      setJob(current => current?.projectId === projectId ? current : unfinished ?? null);
      if (unfinished) {
        setLanguage(languageOptions.some(([value]) => value === unfinished.languageCode) ? unfinished.languageCode : "");
        setProfileId(profileForModelKind(unfinished.modelKind));
      } else if (checkAttempt === 0 && localResourceStatus?.preferredProfile === "fast") setProfileId("fast");
    }).catch((cause: unknown) => { if (active) setJobsReadError(userFacingError(cause)); })
      .finally(() => { if (active) setJobsCheckedKey(checkKey); });
    return () => { active = false; };
  }, [currentVersion, localResourceStatus?.preferredProfile, projectId, checkAttempt, checkKey]);

  const bootstrapNotice = runtimeReadError || jobsReadError ? (
    <div className="notice danger transcription-error" role="alert">
      <strong>字幕准备检查未完成</strong>
      {runtimeReadError ? <p>{runtimeReadError}</p> : null}
      {jobsReadError ? <p>{jobsReadError}</p> : null}
      <button className="button quiet" type="button" disabled={runtimeLoading || jobsLoading || operation !== null}
        onClick={() => setCheckAttempt(value => value + 1)}>重新检查</button>
    </div>
  ) : null;

  useEffect(() => {
    if (job && activeStatuses.has(job.status)) {
      onJobTracked(job.id);
    }
  }, [job, onJobTracked]);

  const [pollFailure, setPollFailure] = useState<{ jobId: string; projectId: string; message: string } | null>(null);
  useTaskPolling({ projectId, task: job, read: getTranscriptionJob, shouldPoll: shouldPollTranscription,
    intervalMs: taskPollingIntervals.transcription,
    onTask: next => {
      setJob(current => {
        if (!current || current.id !== next.id || current.projectId !== next.projectId || !activeStatuses.has(current.status)) return current;
        if (current.stage === "cancelling" && next.stage !== "cancelling" && activeStatuses.has(next.status)) return current;
        return next;
      });
      setPollFailure(null);
    },
    onError: cause => { if (job) setPollFailure({ jobId: job.id, projectId, message: userFacingError(cause) }); },
  });
  const taskError = error ?? (job && activeStatuses.has(job.status) && pollFailure?.jobId === job.id && pollFailure.projectId === projectId ? pollFailure.message : null);

  const completion = useTranscriptionResult({ projectId, job, read: getSubtitleVersion, onResult: onVersionReady });

  const modelKind = modelKindForProfile(profileId);
  const selectedModel = runtimeStatus?.models.find(
    (model) => model.modelKind === modelKind,
  );
  const managedCapability = localResourceStatus?.capabilities.find(
    (capability) => capability.id === "local_transcription",
  );
  const managedResourcesReady =
    localResourceStatus === undefined ||
    (localResourceStatus?.preferredProfile === profileId &&
      managedCapability?.state === "ready");
  const canStart =
    !runtimeLoading && !jobsLoading && !runtimeReadError && !jobsReadError &&
    managedResourcesReady &&
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
      onJobTracked(nextJob.id);
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
      const nextJob = await resumeTranscriptionJob(job.id);
      onJobTracked(nextJob.id);
      setJob(nextJob);
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setOperation(null);
    }
  };

  if ((runtimeLoading || jobsLoading) && !job && !runtimeReadError && !jobsReadError) {
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
            <dd>{job.modelKind === "small" ? "标准" : "快速"}</dd>
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
              disabled={operation !== null || job.stage === "cancelling"}
              onClick={() => void cancel()}
            >
              {operation === "cancel" || job.stage === "cancelling" ? "正在停止…" : "取消生成"}
            </button>
          </>
        ) : null}
        {job.status === "completed" ? (
          <div className="notice transcription-success">
            <strong>{completion.loading ? "正在读取生成的原文字幕" : completion.error ? "原文字幕已生成，读取尚未完成" : "已生成原文字幕草稿"}</strong>
            {completion.error ? <>
              <p role="alert">{userFacingError(completion.error)}</p>
              <button className="button quiet" type="button" onClick={completion.retry}>重新读取字幕</button>
            </> : <p>{completion.loading ? "读取完成后可回到播放器抽查内容。" : "字幕已经过时间轴检查，可回到播放器抽查内容。"}</p>}
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
        {bootstrapNotice}
        {taskError ? (
          <div className="notice danger transcription-error" role="alert">
            <strong>字幕生成未继续</strong>
            <p>{taskError}</p>
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

      {!managedResourcesReady || !runtimeStatus?.available ? (
        <div className="notice danger" role="alert">
          <strong>本地语音能力尚未就绪</strong>
          <p>选择识别方式后，按实际下载量准备所需内容；完成后会回到这里。</p>
          {onPrepareResources ? (
            <button
              className="button"
              type="button"
              disabled={operation !== null}
              onClick={() => void onPrepareResources(profileId)}
            >
              准备本地字幕识别
            </button>
          ) : null}
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
        {profileOptions.map((profile) => {
          const kind = profile.modelKind;
          const available = runtimeStatus?.models.find(
            (model) => model.modelKind === kind,
          )?.available;
          const profileDefinition = localResourceCatalog?.profiles.find(
            (item) => item.id === profile.id,
          );
          const modelDownloadBytes = (profileDefinition?.resourceIds ?? []).reduce(
            (total, resourceId) => {
              const resource = localResourceCatalog?.resources.find(
                (item) => item.id === resourceId,
              );
              return (
                total +
                (resource?.artifact?.size ?? resource?.expectedDownloadSize ?? 0)
              );
            },
            0,
          );
          const prepared =
            managedResourcesReady &&
            localResourceStatus?.preferredProfile === profile.id &&
            available;
          return (
            <label key={profile.id}>
              <input
                type="radio"
                name="transcription-model"
                value={profile.id}
                checked={profileId === profile.id}
                disabled={operation !== null}
                onChange={() => setProfileId(profile.id)}
              />
              <span>
                <strong>{profile.title}</strong>
                <small>
                  {kind === "small"
                    ? "更适合人名、称谓和小语种对白"
                    : "速度优先，准确度可能低于标准识别"}
                  {modelDownloadBytes > 0
                    ? ` · 识别模型下载 ${formatDownloadBytes(modelDownloadBytes)}`
                    : ""}
                </small>
              </span>
              {!prepared ? <em>未准备</em> : null}
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

      {bootstrapNotice}
      {error ? (
        <div className="notice danger transcription-error" role="alert">
          <strong>无法开始生成</strong>
          <p>{error}</p>
        </div>
      ) : null}
    </section>
  );
}
