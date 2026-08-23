import type { SpeechVoice } from "./speechTypes";

function normalize(language: string): string {
  return language.trim().replaceAll("_", "-").toLowerCase();
}

function base(language: string): string {
  return normalize(language).split("-")[0] ?? "";
}

export function voicesForLanguage(
  voices: SpeechVoice[],
  language: string,
): SpeechVoice[] {
  const normalized = normalize(language);
  const exact = voices.filter(
    (voice) => normalize(voice.language) === normalized,
  );
  if (exact.length) {
    return exact;
  }
  const requestedBase = base(language);
  return voices.filter(
    (voice) => requestedBase !== "" && base(voice.language) === requestedBase,
  );
}

export function preferredVoice(
  voices: SpeechVoice[],
  language: string,
  preferredId: string | null,
): SpeechVoice | null {
  const matching = voicesForLanguage(voices, language);
  return matching.find((voice) => voice.id === preferredId) ?? matching[0] ?? null;
}

export function speechPackLabel(language: string): string {
  const labels: Record<string, string> = {
    en: "英语",
    th: "泰语",
    ja: "日语",
    ko: "韩语",
  };
  return labels[base(language)] ?? language;
}
