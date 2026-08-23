import { formatDuration } from "../../lib/format";
import type { Explanation, ExplanationEntry } from "../../types";

const DEFAULT_VISIBLE_ITEMS = 5;

type UnderstandingResultViewProps = {
  explanation: Explanation;
  factsExpanded: boolean;
  interpretationsExpanded: boolean;
  onFactsExpandedChange: (expanded: boolean) => void;
  onInterpretationsExpandedChange: (expanded: boolean) => void;
  onAnalyzeAgain: () => void;
};

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

function Evidence({ entry }: { entry: ExplanationEntry }) {
  if (entry.subtitleSegmentIds.length === 0 && entry.frameIds.length === 0) {
    return <small className="understanding-evidence legacy">旧版结果未保存依据引用</small>;
  }
  const subtitleIds = entry.subtitleSegmentIds.map(shortId).join("、");
  const frameIds = entry.frameIds.map(shortId).join("、");
  return (
    <small className="understanding-evidence">
      依据：
      {subtitleIds ? `字幕 ${subtitleIds}` : ""}
      {subtitleIds && frameIds ? " · " : ""}
      {frameIds ? `画面 ${frameIds}` : ""}
    </small>
  );
}

function EntryList({ entries }: { entries: ExplanationEntry[] }) {
  return (
    <ul>
      {entries.map((entry, index) => (
        <li key={`${entry.text}-${index}`}>
          <span>{entry.text}</span>
          <Evidence entry={entry} />
        </li>
      ))}
    </ul>
  );
}

export function UnderstandingResultView({
  explanation,
  factsExpanded,
  interpretationsExpanded,
  onFactsExpandedChange,
  onInterpretationsExpandedChange,
  onAnalyzeAgain,
}: UnderstandingResultViewProps) {
  const facts = explanation.confirmedFacts.slice(
    0,
    factsExpanded ? undefined : DEFAULT_VISIBLE_ITEMS,
  );
  const interpretations = explanation.possibleInterpretations.slice(
    0,
    interpretationsExpanded ? undefined : DEFAULT_VISIBLE_ITEMS,
  );
  const summary = explanation.materialSummary;
  const total = explanation.confirmedFacts.length + explanation.possibleInterpretations.length;
  return (
    <div className="understanding-result">
      <div className="understanding-material-summary">
        <div>
          <span>本次材料范围</span>
          <strong>
            {formatDuration(summary.startMs)}–{formatDuration(summary.endMs)}
          </strong>
        </div>
        <ul aria-label="本次材料统计">
          <li>{summary.subtitleCount} 条字幕</li>
          <li>{summary.frameCount} 张关键帧</li>
          <li>{total} 条结果</li>
        </ul>
      </div>
      <section className="understanding-result-section facts-section">
        <div className="understanding-section-heading">
          <div><span>01</span><h3>视频明确呈现的事实</h3></div>
          {explanation.confirmedFacts.length > DEFAULT_VISIBLE_ITEMS ? (
            <button
              aria-expanded={factsExpanded}
              className="understanding-disclosure"
              type="button"
              onClick={() => onFactsExpandedChange(!factsExpanded)}
            >
              {factsExpanded ? "收起部分" : "展开全部"}
            </button>
          ) : null}
        </div>
        <EntryList entries={facts} />
      </section>
      <section className="understanding-result-section interpretation">
        <div className="understanding-section-heading">
          <div><span>02</span><h3>结合当前内容的可能解读</h3></div>
          {explanation.possibleInterpretations.length > DEFAULT_VISIBLE_ITEMS ? (
            <button
              aria-expanded={interpretationsExpanded}
              className="understanding-disclosure"
              type="button"
              onClick={() => onInterpretationsExpandedChange(!interpretationsExpanded)}
            >
              {interpretationsExpanded ? "收起部分" : "展开全部"}
            </button>
          ) : null}
        </div>
        <EntryList entries={interpretations} />
        <p className="understanding-interpretation-note">
          可能解读不是影片后续已经确认的结论。
        </p>
      </section>
      {explanation.withheldReason ? (
        <p className="understanding-withheld">{explanation.withheldReason}</p>
      ) : null}
      <button className="button quiet understanding-again" type="button" onClick={onAnalyzeAgain}>
        理解当前播放位置
      </button>
    </div>
  );
}
