import { invoke } from "@tauri-apps/api/core";
import type { CollectionEpisodePage } from "../generated/collection-episode-page";

export async function readCollectionEpisodePage(collectionId: string, seasonNumber: number | null, offset: number, expectedSnapshotToken?: string): Promise<CollectionEpisodePage> {
  const invalid = () => new Error("剧集分页数据无效或与当前合集不一致，请重新加载");
  if (!collectionId.trim() || !Number.isSafeInteger(offset) || offset < 0
    || (offset > 0 && expectedSnapshotToken === undefined)
    || (expectedSnapshotToken !== undefined && !/^[a-f0-9]{64}$/.test(expectedSnapshotToken))
    || (seasonNumber !== null && (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0))) throw invalid();
  const { default: validate } = await import("../generated/collection-episode-page.validator.mjs");
  const value: unknown = await invoke("list_collection_episode_page", { input: { collectionId, seasonNumber, offset, expectedSnapshotToken: expectedSnapshotToken ?? null } });
  if (!validate(value) || value.collectionId !== collectionId || value.seasonNumber !== seasonNumber || value.offset !== offset) throw invalid();
  if (!/^[a-f0-9]{64}$/.test(value.snapshotToken)
    || (expectedSnapshotToken !== undefined && value.snapshotToken !== expectedSnapshotToken)) throw invalid();
  const loaded = offset + value.items.length;
  const ids = value.items.map(item => item.projectId);
  if (!Number.isSafeInteger(loaded) || new Set(ids).size !== ids.length
    || value.items.some(item => !item.projectId.trim() || item.collectionId !== collectionId
      || (seasonNumber !== null && item.seasonNumber !== seasonNumber))
    || (value.items.length > 0 && loaded > value.totalCount)) throw invalid();
  if (value.nextOffset === null ? loaded < value.totalCount
    : value.items.length === 0 || value.nextOffset !== loaded || loaded >= value.totalCount) throw invalid();
  return value;
}
