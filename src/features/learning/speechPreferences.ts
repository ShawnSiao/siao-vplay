import type { PreferenceRecord } from "../../lib/preferenceRecord";

export function speechPreference(language: string): PreferenceRecord<string | null> {
  const normalized = language.toLowerCase();
  return {
    key: `siaovplay-preferences.speech-voice:${normalized}`,
    fallback: null,
    decode: (value) => typeof value === "string" && value.length > 0 ? value : undefined,
    legacy: (storage) => storage.getItem(`siaovplay:speech-voice:${normalized}`),
  };
}
