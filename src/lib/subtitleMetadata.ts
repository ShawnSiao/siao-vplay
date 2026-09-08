import type { SubtitleVersion } from "../types";

import type { SubtitleVersionMetadata } from "../generated/subtitle-version-metadata";
import validateMetadata from "../generated/subtitle-version-metadata.validator.mjs";
export type { SubtitleVersionMetadata } from "../generated/subtitle-version-metadata";

export function subtitleMetadata(version: SubtitleVersion): SubtitleVersionMetadata {
  const { id, trackId, projectId, role, versionNumber, status, sourceLabel, languageCode, createdAtMs, isCurrent } = version;
  return { id, trackId, projectId, role, versionNumber, status, sourceLabel, languageCode, createdAtMs, isCurrent, segmentCount: version.segments.length };
}

export function parseSubtitleMetadata(value: unknown): SubtitleVersionMetadata[] {
  if (!Array.isArray(value)) throw new Error("字幕版本列表格式无效");
  return value.map((item: unknown) => {
    if (!validateMetadata(item)) throw new Error("字幕版本列表格式无效");
    return item;
  });
}
