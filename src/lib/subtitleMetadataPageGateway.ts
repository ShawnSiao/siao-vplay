import { invoke } from "@tauri-apps/api/core";
import type { SubtitleMetadataPage } from "../generated/subtitle-metadata-page";

export async function readSubtitleMetadataPage(projectId: string, offset: number, expectedSnapshotToken?: string): Promise<SubtitleMetadataPage> {
  const invalid = () => new Error("字幕历史已变化或分页数据无效，请重新读取");
  if (!projectId.trim() || !Number.isSafeInteger(offset) || offset < 0
    || (offset > 0 && expectedSnapshotToken === undefined)
    || (expectedSnapshotToken !== undefined && !/^[a-f0-9]{64}$/.test(expectedSnapshotToken))) throw invalid();
  const { default: validate } = await import("../generated/subtitle-metadata-page.validator.mjs");
  const value: unknown = await invoke("list_subtitle_metadata_page", { input: { projectId, offset, expectedSnapshotToken: expectedSnapshotToken ?? null } });
  if (!validate(value) || value.projectId !== projectId || value.offset !== offset
    || !/^[a-f0-9]{64}$/.test(value.snapshotToken)
    || (expectedSnapshotToken !== undefined && value.snapshotToken !== expectedSnapshotToken)) throw invalid();
  const loaded = offset + value.items.length;
  const current = new Map(value.currentVersions.map(item => [item.id, item]));
  if (current.size !== value.currentVersions.length || current.size > value.totalCount
    || new Set(value.currentVersions.map(item => item.trackId)).size !== current.size
    || value.currentVersions.some(item => !item.isCurrent || item.projectId !== projectId || !item.id.trim() || !item.trackId.trim())
    || value.items.some(item => item.isCurrent !== current.has(item.id)
      || (item.isCurrent && (["trackId", "role", "versionNumber", "status", "sourceLabel", "languageCode", "createdAtMs", "segmentCount"] as const)
        .some(key => item[key] !== current.get(item.id)?.[key])))) throw invalid();
  const ids = value.items.map(item => item.id);
  if (!Number.isSafeInteger(loaded) || new Set(ids).size !== ids.length
    || value.items.some(item => item.projectId !== projectId || !item.id.trim() || !item.trackId.trim())
    || (value.items.length > 0 && loaded > value.totalCount)) throw invalid();
  if (value.nextOffset === null ? loaded < value.totalCount
    : value.items.length === 0 || value.nextOffset !== loaded || loaded >= value.totalCount) throw invalid();
  return value;
}
