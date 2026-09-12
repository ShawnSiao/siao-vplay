import { dictionaryEntryFixture } from "../test-fixtures/dictionary";
import { beforeEach, expect, it, vi } from "vitest";
import { getDictionaryEntry, listDictionaryEntries } from "./desktop";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const entry = dictionaryEntryFixture;
beforeEach(() => { invoke.mockReset(); });
it.each([{ id: "wrong" }, { selectionKind: "unknown" }, { contextualMeaning: null }, { playbackPositionMs: -1 },
  { createdAtMs: Number.MAX_SAFE_INTEGER + 1 }, { taskId: "" }])("rejects invalid dictionary results %j", async patch => {
  invoke.mockResolvedValue({ ...entry, ...patch });
  await expect(getDictionaryEntry(entry.id)).rejects.toThrow();
});
it("rejects another project's results and duplicate history", async () => {
  for (const value of [null, [entry, entry], [{ ...entry, projectId: "other" }]]) {
    invoke.mockResolvedValue(value);
    await expect(listDictionaryEntries(entry.projectId)).rejects.toThrow();
  }
});
it("accepts the complete stored result without rewriting it", async () => {
  invoke.mockResolvedValue(entry);
  await expect(getDictionaryEntry(entry.id)).resolves.toEqual(entry);
});
