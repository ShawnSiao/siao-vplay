import { invoke } from "@tauri-apps/api/core";
import type { SearchResult } from "../generated/library-search-result";
import validate from "../generated/library-search-result.validator.mjs";

export async function readLibrarySearch(query: string): Promise<SearchResult[]> {
  const value: unknown = await invoke("search_library", { query });
  const invalid = () => new Error("搜索结果无效，请重新搜索");
  if (!Array.isArray(value)) throw invalid();
  const ids = new Set<string>();
  const result: SearchResult[] = [];
  for (const item of value) {
    if (!validate(item)) throw invalid();
    const collection = item.collectionId?.trim();
    const project = item.projectId?.trim();
    if (item.kind === "collection") {
      if (!collection || item.projectId !== null || item.seasonNumber !== null || item.episodeNumber !== null) throw invalid();
    } else if (item.kind === "episode") {
      if (!project || !collection) throw invalid();
    } else if (!project || item.collectionId !== null || item.seasonNumber !== null || item.episodeNumber !== null) {
      throw invalid();
    }
    const key = item.kind === "collection" ? `collection:${item.collectionId}` : `project:${item.projectId}`;
    if (ids.has(key)) throw invalid();
    ids.add(key);
    result.push(item);
  }
  return result;
}
