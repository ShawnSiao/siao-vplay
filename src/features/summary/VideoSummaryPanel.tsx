import { useCallback, useEffect, useRef, useState } from "react";

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
  resumeSummaryTask,
  startSummaryTask,
} from "./gateway";
import { SummaryProgress } from "./SummaryProgress";
import { SummaryResultView } from "./SummaryResultView";
import { SummarySetup } from "./SummarySetup";
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

const pollingStatuses = new Set(["queued", "running", "validating"]);
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
  const completionRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (!task || !pollingStatuses.has(task.status)) return;
    let active = true;
    const timer = window.setInterval(() => {
      void getSummaryTask(task.id).then((next) => {
        if (active) setTask(next);
      }).catch((cause) => {
        if (active) showError(cause);
      });
    }, 900);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [showError, task]);

  useEffect(() => {
    if (!task?.outputSummaryId || task.status !== "completed" || completionRef.current === task.id) return;
    completionRef.current = task.id;
    void getVideoSummary(task.outputSummaryId).then((value) => {
      setSummary(value);
      setHistory((current) => [value, ...current.filter((item) => item.id !== value.id)]);
    }).catch(showError);
  }, [showError, task]);

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
      completionRef.current = null;
      setSummary(null);
      setTask(prepared);
      setTask(await startSummaryTask(prepared.id));
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
      setTask(await resumeSummaryTask(task.id));
    } catch (cause) {
      showError(cause);
    } finally {
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
    completionRef.current = null;
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
      {error ? <div className="understanding-error" role="alert">{error}</div> : null}
      {summary ? (
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
