import type { DictionaryEntry } from "../../types";
import { SpeechButton } from "./SpeechButton";
import type { LocalSpeechController } from "./useLocalSpeech";

type LearningResultSectionProps = {
  entry: DictionaryEntry;
  speech: LocalSpeechController;
  busy: boolean;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
};

export function LearningResultSection({
  entry,
  speech,
  busy,
  saved,
  saving,
  onSave,
  onReset,
}: LearningResultSectionProps) {
  return (
    <section className="learning-result">
      <div className="learning-result-heading">
        <div>
          <strong>{entry.selectedText}</strong>
          <span>{entry.pronunciation}</span>
        </div>
        <em>{entry.partOfSpeech}</em>
      </div>
      <SpeechButton
        controller={speech}
        text={entry.selectedText}
        language={entry.languageCode}
        sourceId={`entry:${entry.id}`}
        label={`朗读${entry.selectedText}`}
      />
      <p>{entry.contextualMeaning}</p>
      {entry.usageNote ? <small>{entry.usageNote}</small> : null}
      <button
        className="button primary learning-primary"
        type="button"
        disabled={busy || saved}
        onClick={onSave}
      >
        {saved ? "已收藏" : saving ? "正在截取场景…" : "收藏台词和场景"}
      </button>
      <button
        className="button text learning-reset"
        type="button"
        disabled={busy}
        onClick={onReset}
      >
        查询其他内容
      </button>
    </section>
  );
}
