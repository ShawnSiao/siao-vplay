import type { SubtitleVersion } from "../../types";

export type SubtitleVersionMetadata = Pick<SubtitleVersion,
  "id" | "trackId" | "projectId" | "role" | "versionNumber" | "status" | "sourceLabel" |
  "languageCode" | "createdAtMs" | "isCurrent"> & { segmentCount: number };

export function subtitleMetadata(version: SubtitleVersion): SubtitleVersionMetadata {
  const { id, trackId, projectId, role, versionNumber, status, sourceLabel, languageCode, createdAtMs, isCurrent } = version;
  return { id, trackId, projectId, role, versionNumber, status, sourceLabel, languageCode, createdAtMs, isCurrent, segmentCount: version.segments.length };
}

export function parseSubtitleMetadata(value: unknown): SubtitleVersionMetadata[] {
  if (!Array.isArray(value)) throw new Error("字幕版本列表格式无效");
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("字幕版本列表格式无效");
    const row = item as Record<string, unknown>;
    if (!["id", "trackId", "projectId", "sourceLabel", "languageCode"].every((key) => typeof row[key] === "string") ||
      typeof row.role !== "string" || !["original", "translation"].includes(row.role) ||
      typeof row.status !== "string" || !["draft", "ready", "rejected"].includes(row.status) ||
      typeof row.isCurrent !== "boolean" || ![row.versionNumber, row.createdAtMs, row.segmentCount].every(Number.isSafeInteger) ||
      Number(row.versionNumber) < 1 || Number(row.segmentCount) < 0 || "segments" in row || "preflight" in row) {
      throw new Error("字幕版本列表格式无效");
    }
    return row as SubtitleVersionMetadata;
  });
}
