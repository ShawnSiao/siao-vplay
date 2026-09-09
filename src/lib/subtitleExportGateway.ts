import { invoke } from "@tauri-apps/api/core";
import type { SubtitleExport, SubtitleExportMode, SubtitleExportFormat } from "../types";

export async function exportSubtitles(projectId: string, mode: SubtitleExportMode, format: SubtitleExportFormat, sourceVersionId: string | null, translationVersionId: string | null, destinationDirectory: string): Promise<SubtitleExport> {
  const { default: validate } = await import("../generated/subtitle-export.validator.mjs");
  const value = await invoke<unknown>("export_subtitles", { input: {
    projectId, mode, format, sourceVersionId, translationVersionId, destinationDirectory, confirmVersionSelection: true,
  } });
  const expectedSource = mode === "translation" ? null : sourceVersionId?.trim() || null;
  const expectedTranslation = mode === "original" ? null : translationVersionId?.trim() || null;
  if (!validate(value) || value.mode !== mode || value.format !== format ||
      value.sourceVersionId !== expectedSource || value.translationVersionId !== expectedTranslation ||
      !value.filePath.trim() || !value.manifestPath.trim() || value.filePath === value.manifestPath ||
      !/^[a-f0-9]{64}$/i.test(value.fileSha256) || !/^[a-f0-9]{64}$/i.test(value.mediaSha256) ||
      !Number.isSafeInteger(value.cueCount) || value.cueCount < 1 ||
      !Number.isSafeInteger(value.exportedAtMs) || value.exportedAtMs < 0) {
    throw new Error("字幕导出结果无效，请检查导出目录与所选字幕版本。");
  }
  return value;
}
