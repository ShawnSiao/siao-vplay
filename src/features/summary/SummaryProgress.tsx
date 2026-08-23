import type { SummaryTask } from "./types";

type SummaryProgressProps = {
  task: SummaryTask;
  busy: boolean;
  onCancel: () => void;
  onResume: () => void;
  onOpenMaterials: () => void;
};

const runningStatuses = new Set(["queued", "running", "validating"]);

export function SummaryProgress({
  task,
  busy,
  onCancel,
  onResume,
  onOpenMaterials,
}: SummaryProgressProps) {
  const completed = task.chunks.filter((chunk) => chunk.status === "completed").length;
  const running = runningStatuses.has(task.status);
  const resumable = ["failed", "interrupted", "paused"].includes(task.status);
  return (
    <div className="summary-progress-view">
      <header className="summary-intro">
        <span>{task.executionKind === "manual" ? "等待其他工具返回" : "后台任务"}</span>
        <h2>{running ? "正在分析视频内容" : task.status === "interrupted" ? "总结任务已中断" : "总结任务状态"}</h2>
        <p>可以继续观看；当前分块结束后会优先处理场景理解和学习查询。</p>
      </header>
      <section className="summary-progress-card" aria-label="总结分块进度">
        <div><span>分块分析</span><strong>已完成 {completed} / {task.chunks.length} 段</strong></div>
        <progress max={1} value={task.progress} />
        <small>{Math.round(task.progress * 100)}% · {task.stage}</small>
      </section>
      <ol className="summary-chunk-list">
        {task.chunks.map((chunk) => (
          <li key={chunk.id} className={chunk.status}>
            <span>第 {chunk.ordinal + 1} 段</span>
            <strong>{chunk.segmentIds.length} 条字幕</strong>
            <em>{chunk.status === "completed" ? "已校验" : chunk.status}</em>
          </li>
        ))}
      </ol>
      {task.errorMessage ? <div className="understanding-error" role="alert">{task.errorMessage}</div> : null}
      {task.executionKind === "manual" && task.status === "awaiting_external_result" ? (
        <div className="summary-manual-guide">
          <p>任务目录包含完整提示词、字幕材料、关键帧和唯一结果 Schema。</p>
          <button className="button primary" type="button" disabled={busy} onClick={onOpenMaterials}>
            打开任务目录
          </button>
          <small>在目录中保存 UTF-8 编码的 `result.json`，然后点击「检查返回结果」。</small>
          <button className="button quiet" type="button" disabled={busy} onClick={onResume}>
            检查返回结果
          </button>
        </div>
      ) : null}
      <div className="summary-task-actions">
        {resumable ? <button className="button primary" type="button" disabled={busy} onClick={onResume}>继续任务</button> : null}
        {running || task.status === "awaiting_external_result" ? (
          <button className="button quiet" type="button" disabled={busy || task.cancelRequested} onClick={onCancel}>
            {task.cancelRequested ? "将在当前请求后取消" : "取消总结"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
