import { formatDuration } from "../../lib/format";
import type { SummaryDispatchPreview } from "./dispatchGateway";

type Props = {
  preview: SummaryDispatchPreview;
  busy: boolean;
  onConfirm: () => void;
  onBack: () => void;
};

export function SummaryDispatchConfirm({ preview, busy, onConfirm, onBack }: Props) {
  const manual = preview.executionKind === "manual";
  return (
    <section className="ai-execution-confirm summary-dispatch-confirm" aria-label="总结材料确认">
      <h3>{manual ? "确认交接材料" : "确认本次发送"}</h3>
      <div className="ai-execution-scope">
        <div><span>接收方</span><strong>{preview.receiver}</strong></div>
        {preview.endpoint ? <p className="summary-receiver-address">{preview.endpoint}</p> : null}
        <div><span>模型</span><strong>{preview.model}</strong></div>
        {preview.executionKind === "codex" ? <p>使用 Codex 的 OpenAI 登录与默认模型，不读取用户的模型服务配置；需要联网。</p> : null}
        <div><span>字幕范围</span><strong>{preview.scope === "full_video" ? "完整视频（包含未观看内容）" : `截至 ${formatDuration(preview.playbackCutoffMs ?? 0)}`}</strong></div>
        <div><span>字幕版本</span><strong>{preview.subtitleRole === "original" ? "原文" : "译文"} · {preview.subtitleLanguage} · 第 {preview.subtitleVersionNumber} 版</strong></div>
        <p>{preview.segmentCount} 条字幕{preview.scope === "current_progress" ? "，包含截止点所在句的完整文本" : ""}；不附加其他字幕轨道。</p>
        <div><span>分析提示词</span><strong>{preview.promptTemplate}</strong></div>
        {preview.oneTimeRequirements ? <p>补充要求：{preview.oneTimeRequirements}</p> : null}
        <div><span>关键帧</span><strong>{preview.frames.length} 张</strong></div>
        {preview.frames.length ? <ul>{preview.frames.map((frame) => <li key={frame.id}>{formatDuration(frame.timestampMs)}</li>)}</ul> : <p>本次不发送图片。</p>}
        <p>{manual ? "仅准备本地材料，由所选工具决定后续发送。" : "分段分析结果将继续发送给同一接收方，用于合并总结。"}</p>
        <p>材料不包含完整视频、音频、本机媒体路径、数据库或凭证。</p>
      </div>
      <div className="summary-task-actions">
        <button className="button quiet" type="button" disabled={busy} onClick={onBack}>返回任务</button>
        <button className="button primary" type="button" disabled={busy} onClick={onConfirm}>
          {busy ? "正在启动…" : manual ? "确认准备交接" : "确认发送并开始"}
        </button>
      </div>
    </section>
  );
}
