import validatePreview from "../../generated/ai-execution-preview.validator.mjs";
import type { AiExecutionPreview, AiExecutionTarget, AiMaterialAuthorization } from "./types";

export function parseExecutionPreview(
  value: unknown,
  execution: AiExecutionTarget,
  authorization: AiMaterialAuthorization,
): AiExecutionPreview {
  const invalid = () => new Error("AI 执行预览与当前授权不一致");
  if (!validatePreview(value)) throw invalid();
  if (value.executionKind !== execution.kind
    || value.subtitles !== authorization.subtitles
    || value.currentQuestion !== authorization.currentQuestion
    || value.framesRequested !== authorization.frames
    || (value.framesEffective && !authorization.frames)) throw invalid();
  if (execution.kind === "api") {
    if (value.serviceConfigId !== execution.serviceConfigId
      || value.modelId !== execution.modelId
      || value.serviceRevision !== authorization.serviceRevision
      || value.providerId === null) throw invalid();
  } else if (value.serviceConfigId !== null || value.modelId !== null
    || value.serviceRevision !== null || value.providerId !== null) throw invalid();
  return value;
}
