import {
  defaultTargetLanguage,
  translationLanguages,
} from "../config/translationLanguages";

type TranslationLanguageSelectorsProps = {
  sourceLanguageCode: string;
  targetLanguageCode: string;
  sourceVersionLanguageCode: string;
  sourceSegmentCount: number;
  selectedCount: number;
  isSelectedRetranslation: boolean;
  onSourceLanguageChange: (languageCode: string) => void;
  onTargetLanguageChange: (languageCode: string) => void;
};

export function TranslationLanguageSelectors({
  sourceLanguageCode,
  targetLanguageCode,
  sourceVersionLanguageCode,
  sourceSegmentCount,
  selectedCount,
  isSelectedRetranslation,
  onSourceLanguageChange,
  onTargetLanguageChange,
}: TranslationLanguageSelectorsProps) {
  return (
    <div className="translation-source-summary translation-language-selectors">
      <label>
        <span>原始语言</span>
        <select
          aria-label="原始语言"
          value={sourceLanguageCode}
          onChange={(event) => {
            const nextSource = event.target.value;
            onSourceLanguageChange(nextSource);
            if (nextSource === targetLanguageCode) {
              onTargetLanguageChange(defaultTargetLanguage(nextSource));
            }
          }}
        >
          {translationLanguages.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
        <small>
          当前字幕版本标记为 {sourceVersionLanguageCode.toUpperCase()} ·{" "}
          {sourceSegmentCount} 条
        </small>
      </label>
      <span className="translation-arrow">→</span>
      <label>
        <span>目标语言</span>
        <select
          aria-label="目标语言"
          value={targetLanguageCode}
          onChange={(event) => onTargetLanguageChange(event.target.value)}
        >
          {translationLanguages
            .filter((language) => language.code !== sourceLanguageCode)
            .map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
        </select>
        <small>
          {isSelectedRetranslation
            ? `更新 ${selectedCount} 条 · 其余译文保持不变`
            : "独立草稿 · 不覆盖原文"}
        </small>
      </label>
    </div>
  );
}
