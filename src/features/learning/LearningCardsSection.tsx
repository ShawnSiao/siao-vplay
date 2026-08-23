import { playbackUrl } from "../../lib/desktop";
import { formatDuration } from "../../lib/format";
import type { LearningCard } from "../../types";
import { SpeechButton } from "./SpeechButton";
import type { LocalSpeechController } from "./useLocalSpeech";

type LearningCardsSectionProps = {
  cards: LearningCard[];
  speech: LocalSpeechController;
  busy: boolean;
  operation: string | null;
  onExport: () => void;
  onJump: (positionMs: number) => void;
  onDelete: (card: LearningCard) => void;
};

export function LearningCardsSection({
  cards,
  speech,
  busy,
  operation,
  onExport,
  onJump,
  onDelete,
}: LearningCardsSectionProps) {
  return (
    <section className="learning-cards">
      <div className="learning-cards-heading">
        <div><span>学习卡片</span><strong>{cards.length}</strong></div>
        <button type="button" disabled={!cards.length || busy} onClick={onExport}>
          {operation === "export" ? "导出中…" : "导出"}
        </button>
      </div>
      {cards.length ? (
        <div className="learning-card-list">
          {cards.map((card) => (
            <article className="learning-card" key={card.id}>
              {card.screenshotAvailable ? (
                <img alt={`${card.selectedText} 的场景截图`} src={playbackUrl(card.screenshotPath)} />
              ) : <div className="learning-card-missing">截图不可用</div>}
              <div>
                <strong>{card.selectedText}</strong>
                <span>{card.contextualMeaning}</span>
                <small>{formatDuration(card.playbackPositionMs)}</small>
              </div>
              <SpeechButton
                controller={speech}
                text={card.selectedText}
                language={card.languageCode}
                sourceId={`card:${card.id}`}
                label={`朗读卡片${card.selectedText}`}
              />
              <div className="learning-card-actions">
                <button type="button" onClick={() => onJump(card.playbackPositionMs)}>跳回</button>
                <button type="button" disabled={busy} onClick={() => onDelete(card)}>
                  {operation === `delete:${card.id}` ? "删除中" : "删除"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : <p className="learning-cards-empty">查询台词后，可以收藏释义与当前场景。</p>}
    </section>
  );
}
