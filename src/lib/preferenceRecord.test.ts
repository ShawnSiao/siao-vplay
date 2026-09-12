import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPreference, writePreference } from "./preferenceRecord";

const preference = {
  key: "siaovplay-preferences.test",
  fallback: "home",
  decode: (value: unknown) => typeof value === "string" ? value : undefined,
  legacy: (storage: Storage) => storage.getItem("legacy") ?? undefined,
};

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("versioned preference records", () => {
  it("reads legacy values without writing and migrates only on an explicit edit", () => {
    localStorage.setItem("legacy", "series");
    expect(readPreference(preference)).toBe("series");
    expect(localStorage.getItem(preference.key)).toBeNull();
    expect(writePreference(preference, "folders")).toBe("saved");
    expect(readPreference(preference)).toBe("folders");
    expect(localStorage.getItem("legacy")).toBe("series");
  });

  it.each([2, 0, "1", null])("preserves unsupported version %s", (version) => {
    const raw = JSON.stringify({ version, value: "future" });
    localStorage.setItem(preference.key, raw);
    localStorage.setItem("legacy", "series");
    expect(readPreference(preference)).toBe("home");
    expect(writePreference(preference, "folders")).toBe("unsupported-version");
    expect(localStorage.getItem(preference.key)).toBe(raw);
  });

  it("contains storage access and quota failures", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(readPreference(preference)).toBe("home");
    expect(writePreference(preference, "folders")).toBe("unavailable");
    get.mockRestore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(writePreference(preference, "folders")).toBe("unavailable");
  });

  it("rejects malformed records and invalid edits without destroying existing data", () => {
    localStorage.setItem(preference.key, "broken");
    expect(readPreference(preference)).toBe("home");
    expect(writePreference(preference, "folders")).toBe("invalid-record");
    expect(localStorage.getItem(preference.key)).toBe("broken");
    localStorage.removeItem(preference.key);
    expect(writePreference(preference, 123 as unknown as string)).toBe("invalid-value");
    expect(localStorage.getItem(preference.key)).toBeNull();
  });

  it("isolates preference records", () => {
    localStorage.setItem(preference.key, JSON.stringify({ version: 2, value: "future" }));
    const other = { ...preference, key: "siaovplay-preferences.other" };
    expect(writePreference(other, "compact")).toBe("saved");
    expect(readPreference(other)).toBe("compact");
  });

  it("contains a denied localStorage property getter", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    expect(readPreference(preference)).toBe("home");
    expect(writePreference(preference, "folders")).toBe("unavailable");
  });

  it("checks the stored version again at write time", () => {
    expect(readPreference(preference)).toBe("home");
    const raw = JSON.stringify({ version: 3, value: "future" });
    localStorage.setItem(preference.key, raw);
    expect(writePreference(preference, "folders")).toBe("unsupported-version");
    expect(localStorage.getItem(preference.key)).toBe(raw);
  });

  it("uses the decoder for current and legacy values", () => {
    localStorage.setItem(preference.key, JSON.stringify({ version: 1, value: 42 }));
    expect(readPreference(preference)).toBe("home");
    localStorage.removeItem(preference.key);
    expect(readPreference({ ...preference, legacy: () => 42 })).toBe("home");
  });
});
