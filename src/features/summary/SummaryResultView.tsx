import { useMemo, useState } from "react";

import { formatDuration } from "../../lib/format";
import type {
  EvidenceKind,
  SummaryCitation,
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
  onJump?: (positionMs: number) => void;
  onPausePlayback?: () => void;
};

const evidenceLabels: Record<EvidenceKind, string> = {
  video_statement: "视频明确陈述",
  subtitle_or_frame: "字幕或画面证据",
  ai_inference: "AI 推导",
  needs_external_validation: "待外部验证",
};

function CitationButton({
  citation,
  onJump,
  onPausePlayback,
}: {
  citation: SummaryCitation;
  onJump?: (positionMs: number) => void;
  onPausePlayback?: () => void;
}) {
  const label = `${formatDuration(citation.startMs)}–${formatDuration(citation.endMs)} · ${citation.subtitleCount} 条字幕`;
  if (!onJump) return <span className="summary-citation">{label}</span>;
  return (
    <button
      className="summary-citation"
      title={citation.excerpt}
      type="button"
      onClick={() => {
        onPausePlayback?.();
        onJump(citation.startMs);
      }}
    >
      {label}
    </button>
  );
}

function Evidence({
  evidence,
  onJump,
  onPausePlayback,
}: {
  evidence: SummaryEvidence;
  onJump?: (positionMs: number) => void;
  onPausePlayback?: () => void;
}) {
  const citations = evidence.citations ?? [];
  return (
    <li className={`summary-evidence ${evidence.kind}`}>
      <span>{evidenceLabels[evidence.kind]}</span>
      <p>{evidence.claim}</p>
      <div className="summary-citations">
        {citations.map((citation, index) => (
          <CitationButton
            citation={citation}
            key={`${citation.startMs}-${index}`}
            onJump={onJump}
            onPausePlayback={onPausePlayback}
          />
        ))}
        {citations.length === 0 && evidence.subtitleIds.length > 0 ? (
          <span className="summary-citation">{evidence.subtitleIds.length} 条字幕证据</span>
        ) : null}
        {evidence.frameTimestampsMs.map((timestamp) => (
          <button
            className="summary-citation"
            key={`frame-${timestamp}`}
            type="button"
            onClick={() => {
              onPausePlayback?.();
              onJump?.(timestamp);
            }}
          >
            画面 {formatDuration(timestamp)}
          </button>
        ))}
      </div>
      {citations.some((citation) => citation.excerpt) ? (
        <blockquote>{citations.map((citation) => citation.excerpt).join(" ")}</blockquote>
      ) : null}
    </li>
  );
}

function SectionGroup({
  id,
  title,
  sections,
  onJump,
  onPausePlayback,
}: {
  id: string;
  title: string;
  sections: SummarySection[];
  onJump?: (positionMs: number) => void;
  onPausePlayback?: () => void;
}) {
  if (sections.length === 0) return null;
  return (
    <section className="summary-result-group" id={id}>
      <header><span>{String(sections.length).padStart(2, "0")}</span><h3>{title}</h3></header>
      {sections.map((section, index) => (
        <article key={`${section.title}-${index}`}>
          <h4>{section.title}</h4>
          {section.body.split(/\n{2,}/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <details className="summary-evidence-details">
            <summary>依据与推导（{section.evidence.length} 项）</summary>
            <ul>
              {section.evidence.map((evidence, evidenceIndex) => (
                <Evidence
                  evidence={evidence}
                  key={`${evidence.claim}-${evidenceIndex}`}
                  onJump={onJump}
                  onPausePlayback={onPausePlayback}
                />
              ))}
            </ul>
          </details>
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
  onJump,
  onPausePlayback,
}: SummaryResultViewProps) {
  const [expanded, setExpanded] = useState(false);
  const result = summary.result;
  const groups = useMemo(() => [
    ["summary-narrative", "讲述脉络", result.speakerNarrative ?? []] as const,
    ["summary-timeline", "时间线", result.timeline] as const,
    ["summary-concepts", "核心概念", result.coreConcepts] as const,
    ["summary-principles", "原理或架构", result.principlesOrArchitecture] as const,
    ["summary-examples", "具体例子与适用场景", result.examplesAndScenarios ?? []] as const,
    ["summary-tradeoffs", "设计权衡与边界", result.designTradeoffs ?? []] as const,
    ["summary-conclusions", "结论", result.conclusions] as const,
  ].filter((group) => group[2].length > 0), [result]);
  const readingCharacters = [result.overview, ...groups.flatMap((group) => group[2].map((item) => item.body))]
    .join("").replace(/\s/g, "").length;
  const readingMinutes = Math.max(1, Math.ceil(readingCharacters / 500));

  return (
    <div className={`summary-result-view ${expanded ? "summary-reader-expanded" : ""}`}>
      <div className="summary-reader-toolbar">
        <span>{groups.length} 章 · 约 {readingMinutes} 分钟可读</span>
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : "展开阅读"}
        </button>
      </div>
      <header className="summary-result-hero">
        <span>{summary.scope === "full_video" ? "完整视频分析" : `截至 ${formatDuration(summary.playbackCutoffMs ?? 0)}`}</span>
        <h2>{result.title}</h2>
        <div className="summary-overview-copy">
          {result.overview.split(/\n{2,}/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <small>AI 使用视觉材料：{summary.visualMaterialUsed ? "是" : "否"}</small>
      </header>
      <nav className="summary-chapter-navigation" aria-label="总结章节">
        {groups.map(([id, title]) => (
          <button key={id} type="button" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{title}</button>
        ))}
      </nav>
      {groups.map(([id, title, sections]) => (
        <SectionGroup id={id} key={id} title={title} sections={sections} onJump={onJump} onPausePlayback={onPausePlayback} />
      ))}
      {result.mermaid ? <section className="summary-mermaid"><h3>架构关系</h3><pre>{result.mermaid}</pre></section> : null}
      {result.limitations.length > 0 ? <section className="summary-limitations"><h3>局限与待验证</h3><ul>{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
      {result.glossary.length > 0 ? <section className="summary-glossary"><h3>术语表</h3><dl>{result.glossary.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.explanation}</dd></div>)}</dl></section> : null}
      <div className="summary-result-actions">
        <button className="button primary" type="button" disabled={exporting} onClick={onExport}>{exporting ? "正在导出…" : "保存 Markdown 报告"}</button>
        <button className="button quiet" type="button" disabled={exporting} onClick={onNewSummary}>新建总结</button>
      </div>
      {exportNotice ? <p className="summary-export-notice" role="status">{exportNotice}</p> : null}
    </div>
  );
}
