import { formatDuration } from "../../lib/format";
import { translationLanguageLabel } from "../../config/translationLanguages";
import type { TranslationDispatchPreview } from "./translationDispatch";
import "./taskDispatch.css";

export function TranslationDispatchConfirm({ preview, busy, onConfirm, onBack }: {
  preview: TranslationDispatchPreview; busy: boolean; onConfirm: () => void; onBack: () => void;
}) {
  const first = preview.segments.reduce((time, item) => Math.min(time, item.startMs), Infinity);
  const last = preview.segments.reduce((time, item) => Math.max(time, item.endMs), 0);
  return <section className="task-dispatch-confirm" aria-label="翻译发送清单">
    <h3>确认本次翻译</h3>
    <div className="ai-execution-scope">
      <div><span>接收方</span><strong>{preview.receiver}</strong></div>
      <div><span>模型</span><strong>{preview.model}</strong></div>
      <p>{translationLanguageLabel(preview.sourceLanguageCode)}原文 · 第 {preview.sourceVersionNumber} 版 → {translationLanguageLabel(preview.targetLanguageCode)}</p>
      <p>{preview.scope === "full_subtitles" ? "完整字幕" : "选中字幕"} · {preview.segments.length} 条 · {formatDuration(first)}–{formatDuration(last)}</p>
      <p>翻译包含所列范围的完整文本，不按当前播放点截断。</p>
      <details><summary>查看字幕时间范围</summary><ul>{preview.segments.map((item) => <li key={item.id}>{formatDuration(item.startMs)}–{formatDuration(item.endMs)}</li>)}</ul></details>
      <details><summary>翻译规则与术语上下文</summary>
        <p>{String(preview.context.translationGoal ?? "按原文生成目标语言字幕")}</p>
        <ul>{Array.isArray(preview.context.consistencyRules) ? preview.context.consistencyRules.map((rule, index) => <li key={index}>{String(rule)}</li>) : null}</ul>
        <p>人物：{contextText(preview.context.characters)}；剧情：{contextText(preview.context.storyContext)}</p>
        <p>人名：{contextText(preview.glossary.people)}；地点：{contextText(preview.glossary.places)}；术语：{contextText(preview.glossary.terms)}</p>
      </details>
      <p>不发送图片、视频、音频或本机媒体路径。结果保存为独立译文草稿，原文保持不变。</p>
      {preview.handoffKind === "api" ? <p>通过所选 API 服务联网翻译，可能产生服务费用。失败后可重试未完成批次。</p> : preview.handoffKind === "codex" ? <p>通过 Codex 的 OpenAI 登录联网处理，不读取用户的模型服务配置。</p> : <p>仅准备本地交接材料。复制后由所选工具发送，提示词含受控的任务返回路径。</p>}
    </div>
    <div className="task-dispatch-actions">
      <button className="button quiet" type="button" disabled={busy} onClick={onBack}>返回任务</button>
      <button className="button primary" type="button" disabled={busy} onClick={onConfirm}>{busy ? "正在启动…" : preview.handoffKind !== "manual" ? "确认发送并翻译" : "确认准备交接"}</button>
    </div>
  </section>;
}

function contextText(value: unknown): string {
  if (value === null || value === undefined) return "未提供";
  if (Array.isArray(value)) return value.length ? value.map(contextText).join("；") : "未提供";
  if (typeof value === "object") return Object.values(value).map(contextText).join(" · ");
  return String(value);
}
