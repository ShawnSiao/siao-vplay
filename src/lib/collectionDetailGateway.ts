import { invoke } from "@tauri-apps/api/core";
import type { CollectionDetail } from "../generated/collection-detail";
import validate from "../generated/collection-detail.validator.mjs";

function checked(value: unknown, collectionId?: string): CollectionDetail {
  const invalid = () => new Error("合集详情无效，请重新加载");
  if (!validate(value) || !value.summary.id.trim()
    || (collectionId !== undefined && value.summary.id !== collectionId)) throw invalid();
  const seasons = value.seasons.map(season => season.seasonNumber);
  if (new Set(seasons).size !== seasons.length
    || value.summary.watchedCount > value.summary.itemCount
    || value.seasons.some(season => season.watchedCount > season.episodeCount)) throw invalid();
  return value;
}

export async function invokeCollectionDetail(
  command: "get_collection_detail" | "add_project_to_collection" | "remove_project_from_collection",
  args: Record<string, unknown>, collectionId: string,
): Promise<CollectionDetail> {
  return checked(await invoke(command, args), collectionId);
}

export async function invokeWatchLater(projectId: string, enabled: boolean): Promise<CollectionDetail | null> {
  const value: unknown = await invoke("set_watch_later", { projectId, enabled });
  if (value === null && !enabled) return null;
  const detail = checked(value);
  if (detail.summary.systemKey !== "watch_later") throw new Error("稍后观看合集无效，请重新加载");
  return detail;
}
