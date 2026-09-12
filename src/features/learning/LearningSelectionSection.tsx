import { formatDuration } from "../../lib/format";
import type {
  LearningSelectionKind,
  SubtitleSegment,
  SubtitleVersion,
} from "../../types";
import { SpeechButton } from "./SpeechButton";
import type { SelectablePart } from "./learningSelection";
import type { LocalSpeechController } from "./useLocalSpeech";

type LearningSelectionSectionProps = {
  disabled?: boolean;
  playbackPositionMs: number;
  sourceVersion: SubtitleVersion;
  sourceSegment: SubtitleSegment;
  translationSegment: SubtitleSegment | null;
  selectableParts: SelectablePart[];
  selectedText: string;
  selectionValid: boolean;
  kind: LearningSelectionKind;
  speech: LocalSpeechController;
  onSelectText: (text: string) => void;
};

function kindLabel(kind: LearningSelectionKind): string {
  return kind === "word" ? "词语" : kind === "phrase" ? "短语" : "整句";
}

export function LearningSelectionSection({
  disabled = false,
  playbackPositionMs,
  sourceVersion,
  sourceSegment,
  translationSegment,
  selectableParts,
  selectedText,
  selectionValid,
  kind,
  speech,
  onSelectText,
}: LearningSelectionSectionProps) {
  return (
    <section className="learning-selection">
      <div className="learning-selection-heading">
        <span>{formatDuration(playbackPositionMs)}</span>
        <div>
          <SpeechButton
            controller={speech}
            text={sourceSegment.text}
            language={sourceVersion.languageCode}
            sourceId={`sentence:${sourceSegment.id}`}
            label="朗读当前整句"
          />
          <button type="button" disabled={disabled} onClick={() => onSelectText(sourceSegment.text)}>
            选整句
          </button>
        </div>
      </div>
      <div
        aria-label="选择原文词语"
        className="learning-words"
        lang={sourceVersion.languageCode}
      >
        {selectableParts.map((part, index) => part.selectable ? (
          <button
            className={selectedText === part.text ? "selected" : undefined}
            key={`${index}-${part.text}`}
            type="button"
            disabled={disabled}
            onClick={() => {
              onSelectText(part.text);
              void speech.speak(
                part.text,
                sourceVersion.languageCode,
                `word:${sourceSegment.id}:${part.text}`,
              );
            }}
          >
            {part.text}
          </button>
        ) : <span key={`${index}-${part.text}`}>{part.text}</span>)}
      </div>
      {translationSegment ? (
        <p className="learning-translation" lang="zh-CN">{translationSegment.text}</p>
      ) : null}
      <label className="learning-selection-input">
        <span>查询内容 · {kindLabel(kind)}</span>
        <div>
          <input
            aria-invalid={!selectionValid}
            aria-label="要查询的原文"
            disabled={disabled}
            value={selectedText}
            onChange={(event) => onSelectText(event.target.value)}
          />
          <SpeechButton
            controller={speech}
            text={selectedText}
            language={sourceVersion.languageCode}
            sourceId="selection"
            label="朗读选中的词语或短语"
            disabled={!selectionValid}
          />
        </div>
      </label>
      {!selectionValid ? (
        <small className="learning-selection-error">查询内容必须完整出现在当前原文字幕中。</small>
      ) : null}
      <div className="learning-voice-settings">
        {speech.matchingVoices.length ? (
          <label>
            <span>Windows 本机声音</span>
            <select
              aria-label="朗读声音"
              value={speech.selectedVoiceId ?? ""}
              onChange={(event) => speech.setSelectedVoiceId(event.target.value)}
            >
              {speech.matchingVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.displayName} · {voice.language}
                </option>
              ))}
            </select>
          </label>
        ) : speech.missingVoiceMessage ? (
          <p role="status">{speech.missingVoiceMessage}</p>
        ) : (
          <span>正在读取 Windows 本机声音…</span>
        )}
        {speech.error ? <p className="learning-speech-error" role="alert">{speech.error}</p> : null}
      </div>
    </section>
  );
}
