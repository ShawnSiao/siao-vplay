import validateRequest from "../generated/ai-execution-request.validator.mjs";
import type { AiExecutionTarget, AiMaterialAuthorization, PreviewAiExecutionInput } from "../generated/ai-execution-request";

export function aiExecutionRequest(
  execution: AiExecutionTarget,
  authorization: AiMaterialAuthorization,
): PreviewAiExecutionInput {
  const request = { execution: { ...execution }, authorization: { ...authorization } };
  const invalid = () => new Error("AI 处理方式或材料授权无效");
  if (!validateRequest(request)) throw invalid();
  if (!request.authorization.subtitles || !request.authorization.currentQuestion) throw invalid();
  if (request.execution.kind === "api") {
    if (!request.execution.serviceConfigId.trim() || !request.execution.modelId.trim()
      || request.authorization.serviceRevision === null) throw invalid();
  } else if (request.authorization.serviceRevision !== null) throw invalid();
  return request;
}
