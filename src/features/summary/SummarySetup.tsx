import type { CodexRuntimeStatus } from "../../types";
import { AiTaskExecutionSetup } from "../ai-tasks/AiTaskExecutionSetup";
import type { AiExecutionChoiceController } from "../ai-tasks/useAiExecutionChoice";
import type { PromptSelection } from "../analysis/types";
import { formatDuration } from "../../lib/format";
import { SummaryPromptSelector } from "./SummaryPromptSelector";
import type { SummaryAnalysisMode, SummaryScope } from "./types";

type SummarySetupProps = {
  playbackCutoffMs: number;
  durationMs: number | null;
  scope: SummaryScope;
  mode: SummaryAnalysisMode;
  promptSelection: PromptSelection;
  spoilerConfirmed: boolean;
  busy: boolean;
  runtime: CodexRuntimeStatus | null;
  execution: AiExecutionChoiceController;
  translationAvailable: boolean;
  onScopeChange: (scope: SummaryScope) => void;
  onModeChange: (mode: SummaryAnalysisMode) => void;
  onPromptChange: (selection: PromptSelection) => void;
  onSpoilerConfirmedChange: (confirmed: boolean) => void;
  onError: (cause: unknown) => void;
  onStart: () => void;
};

export function SummarySetup({
  playbackCutoffMs,
  durationMs,
  scope,
  mode,
  promptSelection,
  spoilerConfirmed,
  busy,
  runtime,
  execution,
  translationAvailable,
  onScopeChange,
  onModeChange,
  onPromptChange,
  onSpoilerConfirmedChange,
  onError,
  onStart,
}: SummarySetupProps) {
  const fullVideo = scope === "full_video";
  return (
    <div className="summary-setup">
      <header className="summary-intro">
        <span>视频总结</span>
        <h2>生成可保存的深度分析</h2>
        <p>总结仅在主动启动后运行；关闭抽屉不会中断后台任务。</p>
      </header>

      <fieldset className="summary-choice-group">
        <legend>分析范围</legend>
        <label className={scope === "current_progress" ? "selected" : ""}>
          <input
            checked={scope === "current_progress"}
            name="summary-scope"
            type="radio"
            onChange={() => onScopeChange("current_progress")}
          />
          <span><strong>截至当前进度</strong><small>{formatDuration(playbackCutoffMs)} · 默认无剧透</small></span>
        </label>
        <label className={fullVideo ? "selected" : ""}>
          <input
            checked={fullVideo}
            name="summary-scope"
            type="radio"
            onChange={() => onScopeChange("full_video")}
          />
          <span><strong>完整视频</strong><small>{durationMs ? formatDuration(durationMs) : "全部字幕"} · 需要确认剧透</small></span>
        </label>
      </fieldset>

      {fullVideo ? (
        <label className="summary-spoiler-confirm">
          <input
            type="checkbox"
            checked={spoilerConfirmed}
            onChange={(event) => onSpoilerConfirmedChange(event.currentTarget.checked)}
          />
          <span><strong>确认分析完整视频</strong><small>结果可能包含尚未观看的内容和结局。</small></span>
        </label>
      ) : null}

      <label className="summary-field">
        <span>分析模式</span>
        <select
          aria-label="视频总结分析模式"
          value={mode}
          disabled={busy}
          onChange={(event) => onModeChange(event.currentTarget.value as SummaryAnalysisMode)}
        >
          <option value="automatic">自动判断</option>
          <option value="general">通用总结</option>
          <option value="science_technology">科学技术原理</option>
          <option value="software_architecture">软件与系统架构</option>
        </select>
      </label>

      <SummaryPromptSelector
        value={promptSelection}
        disabled={busy}
        onChange={onPromptChange}
        onError={onError}
      />

      <AiTaskExecutionSetup
        controller={execution}
        runtime={runtime}
        allowFrames
        translationAvailable={translationAvailable}
        taskLabel="视频总结"
        actionLabel="开始生成总结"
        operationLabel="正在准备总结…"
        buttonClassName="summary-primary"
        busy={busy}
        blocked={playbackCutoffMs <= 0 || (fullVideo && !spoilerConfirmed)}
        onStart={onStart}
      />
      <p className="summary-scope-note">
        接收方：<strong>{execution.kind === "api" ? execution.service?.displayName ?? "AI 服务" : execution.kind === "codex" ? "本机 Codex" : "自行选择的工具"}</strong>
        · 字幕范围：{fullVideo ? "完整视频" : `截至 ${formatDuration(playbackCutoffMs)}`}
      </p>
    </div>
  );
}
