import { invoke } from "@tauri-apps/api/core";
import { parseDictionaryEntry } from "./dictionaryContract";
import type { DictionaryEntry } from "../types";
export async function getDictionaryEntry(entryId: string): Promise<DictionaryEntry> {
  return parseDictionaryEntry(await invoke<unknown>("get_dictionary_entry", { entryId }), { entryId });
}
export async function listDictionaryEntries(projectId: string): Promise<DictionaryEntry[]> {
  const value = await invoke<unknown>("list_dictionary_entries", { projectId });
  if (!Array.isArray(value)) throw new Error("学习结果列表格式无效。");
  const entries = value.map(entry => parseDictionaryEntry(entry, { projectId }));
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error("学习结果列表包含重复结果。");
  return entries;
}
