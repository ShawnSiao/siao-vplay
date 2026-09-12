import validateFile from "../generated/subtitle-import-preview.validator.mjs";
import validateEmbedded from "../generated/embedded-subtitle-preview.validator.mjs";
import type { SubtitleImportPreview } from "../generated/subtitle-import-preview";
import type { EmbeddedSubtitlePreview } from "../generated/embedded-subtitle-preview";

function consistent(value: SubtitleImportPreview, languageCode: string): boolean {
  return value.languageCode === languageCode.trim().replaceAll("_", "-").toLowerCase()
    && !!value.sourceLabel.trim() && !!value.sourceSha256.trim() && !!value.expectedMediaSha256.trim()
    && value.preflight.segmentCount === value.cues.length
    && value.canImport === (value.preflight.errorCount === 0);
}

export function parseSubtitlePreview(value: unknown, languageCode: string): SubtitleImportPreview {
  if (!validateFile(value) || !consistent(value, languageCode)) {
    throw new Error("字幕预览数据无效或与所选语言不一致，请重新检查字幕");
  }
  return value;
}

export function parseEmbeddedPreview(value: unknown, streamIndex: number, languageCode: string): EmbeddedSubtitlePreview {
  if (!validateEmbedded(value) || !consistent(value, languageCode)
    || value.streamIndex !== streamIndex || !value.codecName.trim()) {
    throw new Error("内嵌字幕预览无效或与所选轨道不一致，请重新检查字幕");
  }
  return value;
}
