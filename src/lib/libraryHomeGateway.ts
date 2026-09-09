import { invoke } from "@tauri-apps/api/core";
import type { LibraryHome } from "../generated/library-home";
import validate from "../generated/library-home.validator.mjs";

export async function readLibraryHome(): Promise<LibraryHome> {
  const value: unknown = await invoke("get_library_home");
  const invalid = () => new Error("媒体库首页数据无效，请重新加载");
  if (!validate(value)) throw invalid();
  const unique = (ids: string[]) => ids.every(id => id.trim().length > 0) && new Set(ids).size === ids.length;
  const mediaLists = [value.continueWatching, value.unclassified, value.recentlyAdded];
  if (mediaLists.some(items => !unique(items.map(item => item.projectId)))
    || !unique(value.collections.map(item => item.id))
    || !unique(value.folders.map(item => item.id))
    || value.continueWatching.length > value.continueWatchingCount
    || value.continueWatchingCount > value.totalProjectCount
    || value.unclassified.length > value.unclassifiedCount
    || value.unclassifiedCount > value.totalProjectCount
    || value.recentlyAdded.length > value.totalProjectCount
    || value.collections.length > value.collectionCount
    || value.folders.length > value.folderCount
    || value.watchLaterCount > value.totalProjectCount
    || value.collections.some(item => item.systemKey !== null || item.watchedCount > item.itemCount)) throw invalid();
  return value;
}
