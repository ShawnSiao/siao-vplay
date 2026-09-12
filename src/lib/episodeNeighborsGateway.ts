import { invoke } from "@tauri-apps/api/core";
import type { EpisodeNeighbors } from "../generated/episode-neighbors-result";
import validate from "../generated/episode-neighbors-result.validator.mjs";

export async function readEpisodeNeighbors(collectionId: string, projectId: string): Promise<EpisodeNeighbors> {
  const value: unknown = await invoke("get_episode_neighbors", { collectionId, projectId });
  const invalid = () => new Error("上下集信息无效，请重新加载");
  if (!validate(value) || value.collectionId !== collectionId || value.projectId !== projectId) throw invalid();
  const ids = [value.neighbors.previous, value.neighbors.next].flatMap(item => item ? [item.projectId] : []);
  if (ids.some(id => !id.trim() || id === projectId) || new Set(ids).size !== ids.length) throw invalid();
  return value.neighbors;
}
