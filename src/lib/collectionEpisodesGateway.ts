import { invoke } from "@tauri-apps/api/core";
import type { MediaSummary } from "../generated/library-media-summary";
import validate from "../generated/library-media-summary.validator.mjs";

export async function readCollectionEpisodes(collectionId: string, seasonNumber: number | null): Promise<MediaSummary[]> {
  const value: unknown = await invoke("list_collection_episodes", { collectionId, seasonNumber });
  const invalid = () => new Error("剧集列表无效，请重新加载");
  if (!Array.isArray(value)) throw invalid();
  const ids = new Set<string>();
  const items: MediaSummary[] = [];
  for (const item of value) {
    if (!validate(item) || !item.projectId.trim() || ids.has(item.projectId)
      || item.collectionId !== collectionId
      || (seasonNumber !== null && item.seasonNumber !== seasonNumber)) throw invalid();
    ids.add(item.projectId);
    items.push(item);
  }
  return items;
}
