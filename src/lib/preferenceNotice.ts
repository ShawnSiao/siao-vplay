import { writePreference, type PreferenceRecord, type PreferenceWriteResult } from "./preferenceRecord";

type Failure = Exclude<PreferenceWriteResult, "saved">;
const listeners = new Set<(failure: Failure) => void>();

export function subscribePreferenceFailures(listener: (failure: Failure) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function savePreference<T>(preference: PreferenceRecord<T>, value: T): PreferenceWriteResult {
  const result = writePreference(preference, value);
  if (result !== "saved") {
    for (const listener of listeners) listener(result);
  }
  return result;
}
