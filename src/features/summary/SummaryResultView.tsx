import { formatDuration } from "../../lib/format";
import type {
  EvidenceKind,
  SummaryEvidence,
  SummarySection,
  VideoSummary,
} from "./types";

type SummaryResultViewProps = {
  summary: VideoSummary;
  exporting: boolean;
  exportNotice: string | null;
  onExport: () => void;
  onNewSummary: () => void;
};

const evidenceLabels: Record<EvidenceKind, string> = {
  video_statement: "视频明确陈述",
  subtitle_or_frame: "字幕或画面证据",
  ai_inference: "AI 推导",
  needs_external_validation: "待外部验证",
};

function Evidence({ evidence }: { evidence: SummaryEvidence }) {
  return (
    <li className={`summary-evidence ${evidence.kind}`}>
      <span>{evidenceLabels[evidence.kind]}</span>
      <p>{evidence.claim}</p>
      {evidence.subtitleIds.length > 0 || evidence.frameTimestampsMs.length > 0 ? (
        <small>
          {evidence.subtitleIds.length > 0 ? `字幕 ${evidence.subtitleIds.join("、")}` : ""}
          {evidence.frameTimestampsMs.length > 0
            ? ` 画面 ${evidence.frameTimestampsMs.map(formatDuration).join("、")}`
            : ""}
        </small>
      ) : null}
    </li>
  );
}

function SectionGroup({ title, sections }: { title: string; sections: SummarySection[] }) {
  if (sections.length === 0) return null;
  return (
    <section className="summary-result-group">
      <header><span>{String(sections.length).padStart(2, "0")}</span><h3>{title}</h3></header>
      {sections.map((section, index) => (
        <article key={`${section.title}-${index}`}>
          <h4>{section.title}</h4>
          <p>{section.body}</p>
          <ul>{section.evidence.map((evidence, evidenceIndex) => <Evidence key={`${evidence.claim}-${evidenceIndex}`} evidence={evidence} />)}</ul>
        </article>
      ))}
    </section>
  );
}

export function SummaryResultView({
  summary,
  exporting,
  exportNotice,
  onExport,
  onNewSummary,
}: SummaryResultViewProps) {
  const result = summary.result;
  return (
    <div className="summary-result-view">
      <header className="summary-result-hero">
        <span>{summary.scope === "full_video" ? "完整视频分析" : `截至 ${formatDuration(summary.playbackCutoffMs ?? 0)}`}</span>
        <h2>{result.title}</h2>
        <p>{result.overview}</p>
        <small>AI 使用视觉材料：{summary.visualMaterialUsed ? "是" : "否"}</small>
      </header>
      <SectionGroup title="时间线" sections={result.timeline} />
      <SectionGroup title="核心概念" sections={result.coreConcepts} />
      <SectionGroup title="原理或架构" sections={result.principlesOrArchitecture} />
      {result.mermaid ? (
        <section className="summary-mermaid">
          <h3>架构关系</h3>
          <pre>{result.mermaid}</pre>
        </section>
      ) : null}
      <SectionGroup title="行动结论" sections={result.conclusions} />
      {result.limitations.length > 0 ? (
        <section className="summary-limitations">
          <h3>局限与待验证</h3>
          <ul>{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}
      {result.glossary.length > 0 ? (
        <section className="summary-glossary">
          <h3>术语表</h3>
          <dl>{result.glossary.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.explanation}</dd></div>)}</dl>
        </section>
      ) : null}
      <div className="summary-result-actions">
        <button className="button primary" type="button" disabled={exporting} onClick={onExport}>
          {exporting ? "正在导出…" : "保存 Markdown 报告"}
        </button>
        <button className="button quiet" type="button" disabled={exporting} onClick={onNewSummary}>
          新建总结
        </button>
      </div>
      {exportNotice ? <p className="summary-export-notice" role="status">{exportNotice}</p> : null}
    </div>
  );
}
