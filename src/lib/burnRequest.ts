import validate from "../generated/subtitle-burn-input.validator.mjs";
import type { StartSubtitleBurnInput } from "../generated/subtitle-burn-input";
export function parseBurnRequest(value: unknown): StartSubtitleBurnInput {
  if (!validate(value) || !value.confirmVersionSelection || !value.projectId.trim() ||
    !value.translationVersionId.trim() || !value.destinationDirectory.trim() ||
    (value.sourceVersionId !== null && !value.sourceVersionId.trim()) ||
    (value.mode === "bilingual" && !value.sourceVersionId)) {
    throw new Error("烧录参数无效，请检查字幕版本、保存位置和字幕样式，并确认版本选择。");
  }
  return value;
}
