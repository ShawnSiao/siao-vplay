import { useCallback, useEffect, useState } from "react";

import { commandError, getCodexRuntimeStatus } from "../../lib/desktop";
import type { CodexRuntimeStatus, SubtitleVersion } from "../../types";
import { useAiExecutionChoice } from "../ai-tasks/useAiExecutionChoice";
import type { PromptSelection } from "../analysis/types";
import {
  cancelSummaryTask,
  chooseSummaryExportDirectory,
  exportVideoSummary,
  getSummaryTask,
  getVideoSummary,
  listSummaryTasks,
  listVideoSummaries,
  openSummaryMaterials,
  prepareSummaryTask,
  previewSummaryDispatch,
  resumeSummaryTask,
  startSummaryTask,
} from "./gateway";
import { useSummaryPolling } from "./useSummaryPolling";
import { useSummaryCompletion } from "./useSummaryCompletion";
import { SummaryProgress } from "./SummaryProgress";
import { SummaryResultView } from "./SummaryResultView";
import { SummarySetup } from "./SummarySetup";
import { SummaryDispatchConfirm } from "./SummaryDispatchConfirm";
import type { SummaryDispatchPreview } from "./dispatchGateway";
import type {
  SummaryAnalysisMode,
  SummaryScope,
  SummaryTask,
  VideoSummary,
} from "./types";

type VideoSummaryPanelProps = {
  projectId: string;
  playbackCutoffMs: number;
  durationMs: number | null;
  sourceVersion: SubtitleVersion | null;
  translationVersion: SubtitleVersion | null;
  onPrepareSubtitles: () => void;
  onJump?: (positionMs: number) => void;
  onPausePlayback?: () => void;
};

const restorableStatuses = new Set([
  "prepared",
  "awaiting_external_result",
  "queued",
  "running",
  "paused",
  "validating",
  "interrupted",
  "failed",
]);

export function VideoSummaryPanel({
  projectId,
  playbackCutoffMs,
  durationMs,
  sourceVersion,
  translationVersion,
  onPrepareSubtitles,
  onJump,
  onPausePlayback,
}: VideoSummaryPanelProps) {
  const execution = useAiExecutionChoice(true);
  const [runtime, setRuntime] = useState<CodexRuntimeStatus | null>(null);
  const [scope, setScope] = useState<SummaryScope>("current_progress");
  const [mode, setMode] = useState<SummaryAnalysisMode>("automatic");
  const [promptSelection, setPromptSelection] = useState<PromptSelection>({
    templateId: "builtin:summary:automatic",
    oneTimeRequirements: "",
  });
  const [spoilerConfirmed, setSpoilerConfirmed] = useState(false);
  const [task, setTask] = useState<SummaryTask | null>(null);
  const [summary, setSummary] = useState<VideoSummary | null>(null);
  const [history, setHistory] = useState<VideoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ preview: SummaryDispatchPreview; resume: boolean } | null>(null);

  const showError = useCallback((cause: unknown) => {
    setError(commandError(cause).message);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getCodexRuntimeStatus(),
      listSummaryTasks(projectId),
      listVideoSummaries(projectId),
    ])
      .then(([nextRuntime, tasks, summaries]) => {
        if (!active) return;
        setRuntime(nextRuntime);
        setHistory(summaries);
        const activeTask = tasks.find((item) => restorableStatuses.has(item.status)) ?? null;
        setTask(activeTask);
        if (!activeTask) setSummary(summaries[0] ?? null);
      })
      .catch(showError)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, showError]);

  useSummaryPolling({ projectId, task, read: getSummaryTask, onTask: (next) => setTask((current) => {
    if (!current || current.id !== next.id || current.projectId !== next.projectId ||
      !["queued", "running", "validating"].includes(current.status)) return current;
    if (current.cancelRequested && !next.cancelRequested && ["queued", "running", "validating"].includes(next.status)) return current;
    return next;
  }), onError: showError });

  const completion = useSummaryCompletion({ projectId, task, read: getVideoSummary, onResult: (value) => {
    setSummary(value);
    setHistory((current) => [value, ...current.filter((item) => item.id !== value.id)]);
  } });

  const start = async () => {
    setOperation("start");
    setError(null);
    setExportNotice(null);
    try {
      const choice = await execution.preview();
      const prepared = await prepareSummaryTask({
        projectId,
        scope,
        playbackCutoffMs: scope === "current_progress" ? playbackCutoffMs : null,
        analysisMode: mode,
        executionKind: choice.execution.kind,
        promptSelection,
        visualMaterialAuthorized: choice.preview.framesEffective,
        subtitlesAuthorized: choice.preview.subtitles,
        spoilerConfirmed: scope === "full_video" && spoilerConfirmed,
        serviceConfigId: choice.preview.serviceConfigId,
        serviceRevision: choice.preview.serviceRevision,
        providerId: choice.preview.providerId,
        modelId: choice.preview.modelId,
      });
      setSummary(null);
      setTask(prepared);
      setConfirmation({ preview: await previewSummaryDispatch(prepared.id), resume: false });
    } catch (cause) {
      showError(cause);
    } finally {
      setOperation(null);
    }
  };

  const cancel = async () => {
    if (!task) return;
    setOperation("cancel");
    setError(null);
    try {
      setTask(await cancelSummaryTask(task.id));
    } catch (cause) {
      showError(cause);
    } finally {
      setOperation(null);
    }
  };

  const resume = async () => {
    if (!task) return;
    setOperation("resume");
    setError(null);
    try {
      setConfirmation({ preview: await previewSummaryDispatch(task.id), resume: true });
    } catch (cause) {
      showError(cause);
    } finally {
      setOperation(null);
    }
  };

  const confirmDispatch = async () => {
    if (!confirmation) return;
    setOperation("confirm");
    setError(null);
    try {
      const run = confirmation.resume ? resumeSummaryTask : startSummaryTask;
      setTask(await run(confirmation.preview.taskId, confirmation.preview.confirmationSha256));
    } catch (cause) {
      showError(cause);
    } finally {
      setConfirmation(null);
      setOperation(null);
    }
  };

  const exportReport = async () => {
    if (!summary) return;
    setOperation("export");
    setError(null);
    setExportNotice(null);
    try {
      const directory = await chooseSummaryExportDirectory();
      if (!directory) return;
      const exported = await exportVideoSummary(summary.id, directory);
      setExportNotice(`报告已保存：${exported.directory}（${exported.assetCount} 张图片）`);
    } catch (cause) {
      showError(cause);
    } finally {
      setOperation(null);
    }
  };

  const newSummary = () => {
    setConfirmation(null);
    setTask(null);
    setSummary(null);
    setError(null);
    setExportNotice(null);
    setScope("current_progress");
    setSpoilerConfirmed(false);
  };

  if (loading) return <div className="understanding-loading" role="status"><span className="spinner" />正在读取视频总结</div>;
  if (!sourceVersion) return <div className="understanding-empty"><strong>需要先准备原文字幕</strong><p>视频总结只分析真实字幕和授权画面。</p><button className="button primary small" type="button" onClick={onPrepareSubtitles}>生成或导入原文字幕</button></div>;

  return (
    <div className="video-summary-panel">
      {history.length > 0 ? (
        <label className="summary-history-select">
          <span>历史结果</span>
          <select
            aria-label="视频总结历史结果"
            value={summary?.id ?? "new"}
            onChange={(event) => {
              const selected = history.find((item) => item.id === event.currentTarget.value) ?? null;
              if (selected) { setTask(null); setSummary(selected); }
              else newSummary();
            }}
          >
            <option value="new">新建总结</option>
            {history.map((item) => <option key={item.id} value={item.id}>{item.result.title}</option>)}
          </select>
        </label>
      ) : null}
      {completion.error ? <div className="understanding-error" role="alert">
        {commandError(completion.error).message}
        <button className="button small" type="button" onClick={completion.retry}>重新读取总结</button>
      </div> : null}
      {error ? <div className="understanding-error" role="alert">{error}</div> : null}
      {confirmation ? <SummaryDispatchConfirm preview={confirmation.preview} busy={operation !== null}
        onConfirm={() => void confirmDispatch()} onBack={() => setConfirmation(null)} /> : summary ? (
        <SummaryResultView summary={summary} exporting={operation === "export"} exportNotice={exportNotice} onExport={() => void exportReport()} onNewSummary={newSummary} onJump={onJump} onPausePlayback={onPausePlayback} />
      ) : task ? (
        <SummaryProgress task={task} busy={operation !== null} onCancel={() => void cancel()} onResume={() => void resume()} onOpenMaterials={() => void openSummaryMaterials(task.id).catch(showError)} />
      ) : (
        <SummarySetup
          playbackCutoffMs={playbackCutoffMs}
          durationMs={durationMs}
          scope={scope}
          mode={mode}
          promptSelection={promptSelection}
          spoilerConfirmed={spoilerConfirmed}
          busy={operation !== null}
          runtime={runtime}
          execution={execution}
          translationAvailable={Boolean(translationVersion)}
          onScopeChange={(next) => { setScope(next); if (next === "current_progress") setSpoilerConfirmed(false); }}
          onModeChange={setMode}
          onPromptChange={setPromptSelection}
          onSpoilerConfirmedChange={setSpoilerConfirmed}
          onError={showError}
          onStart={() => void start()}
        />
      )}
    </div>
  );
}
