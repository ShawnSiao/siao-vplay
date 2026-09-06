import { formatDuration } from "../../lib/format";
import type { TaskDispatchPreview } from "./taskDispatch";
import "./taskDispatch.css";

type Props = { preview: TaskDispatchPreview; busy: boolean; onConfirm: () => void; onBack: () => void };

export function AiTaskDispatchConfirm({ preview, busy, onConfirm, onBack }: Props) {
  const manual = preview.execution.kind === "manual";
  return <section className="ai-execution-confirm task-dispatch-confirm" aria-label="本次发送清单">
    <h3>{manual ? "确认交接材料" : "确认本次发送"}</h3>
    <div className="ai-execution-scope">
      <div><span>接收方</span><strong>{preview.receiver}</strong></div>
      {preview.endpoint ? <p>{preview.endpoint}</p> : null}
      <div><span>模型</span><strong>{preview.model}</strong></div>
      {preview.execution.kind === "codex" ? <p>使用 Codex 的 OpenAI 登录与默认模型，不读取用户的模型服务配置；需要联网。</p> : null}
      <div><span>材料截止点</span><strong>{formatDuration(preview.playbackCutoffMs)}</strong></div>
      <p>{preview.subtitleCount} 条原文及对应译文（如有），包含截止点所在句的完整文本。</p>
      {preview.subtitles.map((subtitle) => <p key={subtitle.versionId}>{subtitle.role === "original" ? "原文" : "译文"} · {subtitle.language} · 第 {subtitle.versionNumber} 版</p>)}
      {preview.selectedText ? <p>查询文本：{preview.selectedText}</p> : null}
      {preview.prompt ? <details><summary>分析要求：{preview.prompt.template}</summary>
        <p>{preview.prompt.requirements}</p>
        {preview.prompt.oneTimeRequirements ? <p>补充要求：{preview.prompt.oneTimeRequirements}</p> : null}
      </details> : null}
      <div><span>关键帧</span><strong>{preview.frames.length} 张</strong></div>
      {preview.frames.length ? <ul>{preview.frames.map((frame) => <li key={frame.id}>{formatDuration(frame.timestampMs)}</li>)}</ul> : <p>本次不发送图片。</p>}
      <p>{manual ? "仅准备本地材料，后续发送由所选工具处理。" : "仅发送此任务的字幕、问题及所列图片。"}不包含完整视频、音频、本机媒体路径或凭证。</p>
    </div>
    <div className="task-dispatch-actions">
      <button className="button quiet" type="button" disabled={busy} onClick={onBack}>返回任务</button>
      <button className="button primary" type="button" disabled={busy} onClick={onConfirm}>
        {busy ? "正在启动…" : manual ? "确认准备交接" : preview.taskKind === "explanation" ? "确认发送并理解" : "确认发送并查询"}
      </button>
    </div>
  </section>;
}
