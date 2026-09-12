export type PreferenceRecord<T> = {
  key: string;
  fallback: T;
  decode: (value: unknown) => T | undefined;
  legacy?: (storage: Storage) => unknown;
};

export type PreferenceWriteResult =
  | "saved"
  | "unavailable"
  | "unsupported-version"
  | "invalid-record"
  | "invalid-value";

function parseRecord(raw: string): { version: unknown; value: unknown } | null {
  try {
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    if (!("version" in record) || !("value" in record)) return null;
    return { version: record.version, value: record.value };
  } catch {
    return null;
  }
}

// Reads never migrate: opening a view must not modify stored preferences.
export function readPreference<T>(preference: PreferenceRecord<T>): T {
  try {
    const storage = window.localStorage;
    const raw = storage.getItem(preference.key);
    if (raw === null) {
      return preference.decode(preference.legacy?.(storage)) ?? preference.fallback;
    }
    const record = parseRecord(raw);
    return record?.version === 1
      ? preference.decode(record.value) ?? preference.fallback
      : preference.fallback;
  } catch {
    return preference.fallback;
  }
}

// Callers keep session state and surface non-saved results to the user.
export function writePreference<T>(
  preference: PreferenceRecord<T>,
  value: T,
): PreferenceWriteResult {
  try {
    const decoded = preference.decode(value);
    if (decoded === undefined) return "invalid-value";
    const storage = window.localStorage;
    const raw = storage.getItem(preference.key);
    if (raw !== null) {
      const record = parseRecord(raw);
      if (!record) return "invalid-record";
      if (record.version !== 1) return "unsupported-version";
    }
    storage.setItem(preference.key, JSON.stringify({ version: 1, value: decoded }));
    return "saved";
  } catch {
    return "unavailable";
  }
}
