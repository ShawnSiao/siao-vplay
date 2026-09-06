import type { SubtitleVersion } from "../../types";

export function mergeCurrentSubtitleVersion(current: SubtitleVersion[], version: SubtitleVersion): SubtitleVersion[] {
  if (!version.isCurrent || current.some((item) => item.trackId === version.trackId &&
    item.isCurrent && item.versionNumber > version.versionNumber)) return current;
  return [version, ...current.filter((item) => item.isCurrent && item.trackId !== version.trackId)];
}
