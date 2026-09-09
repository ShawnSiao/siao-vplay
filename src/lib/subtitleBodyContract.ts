import validate from "../generated/subtitle-version.validator.mjs";
import type { SubtitleVersion } from "../generated/subtitle-version";

export function parseSubtitleBody(value: unknown, projectId: string, versionId?: string): SubtitleVersion {
  if (!validate(value) || value.projectId !== projectId || !value.id.trim() || !value.trackId.trim() ||
      (versionId !== undefined && value.id !== versionId)) {
    throw new Error("字幕版本格式无效或与当前请求不匹配。");
  }
  const ids = new Set<string>();
  for (const segment of value.segments) {
    if (!segment.id.trim() || ids.has(segment.id)) throw new Error("字幕分段标识无效或重复。");
    ids.add(segment.id);
  }
  return value;
}

export function parseSubtitleBodies(value: unknown, projectId: string): SubtitleVersion[] {
  if (!Array.isArray(value)) throw new Error("字幕版本列表格式无效。");
  const versions = value.map(item => parseSubtitleBody(item, projectId));
  if (new Set(versions.map(version => version.id)).size !== versions.length) throw new Error("字幕版本列表包含重复版本。");
  return versions;
}
