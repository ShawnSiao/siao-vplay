export const translationLanguages = [
  { code: "en", label: "英语" },
  { code: "zh-cn", label: "简体中文" },
  { code: "zh-tw", label: "繁體中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "th", label: "ไทย" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
] as const;

export function translationLanguageLabel(code: string): string {
  return (
    translationLanguages.find(
      (language) => language.code.toLowerCase() === code.toLowerCase(),
    )?.label ?? code.toUpperCase()
  );
}

export function defaultTargetLanguage(sourceLanguageCode: string): string {
  return sourceLanguageCode.toLowerCase() === "zh-cn" ? "en" : "zh-cn";
}
