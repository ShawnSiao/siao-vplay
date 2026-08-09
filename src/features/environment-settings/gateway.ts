import { invoke } from "@tauri-apps/api/core";

import type {
  AiExecutionPreview,
  AiExecutionTarget,
  AiMaterialAuthorization,
  AiModelList,
  AiServiceProbeInput,
  AiServiceSettings,
  AiServiceTestResult,
  AiServiceDraft,
  NetworkSettings,
} from "./types";

export function getAiServiceSettings(): Promise<AiServiceSettings> {
  return invoke("get_ai_service_settings");
}

export function saveAiService(
  expectedRevision: number,
  draft: AiServiceDraft,
): Promise<AiServiceSettings> {
  return invoke("save_ai_service", {
    input: {
      expectedRevision,
      id: draft.id,
      providerId: draft.providerId,
      displayName: draft.displayName,
      protocol: draft.protocol,
      baseUrl: draft.baseUrl || null,
      modelId: draft.modelId || null,
      apiKey: draft.apiKey || null,
    },
  });
}

export function deleteAiService(
  expectedRevision: number,
  id: string,
): Promise<AiServiceSettings> {
  return invoke("delete_ai_service", { input: { expectedRevision, id } });
}

export function setDefaultAiService(
  expectedRevision: number,
  id: string | null,
): Promise<AiServiceSettings> {
  return invoke("set_default_ai_service", {
    input: { expectedRevision, id },
  });
}

export function listAiServiceModels(
  input: AiServiceProbeInput,
): Promise<AiModelList> {
  return invoke("list_ai_service_models", { input });
}

export function testAiService(
  input: AiServiceProbeInput,
): Promise<AiServiceTestResult> {
  return invoke("test_ai_service", { input });
}

export function getNetworkSettings(): Promise<NetworkSettings> {
  return invoke("get_network_settings");
}

export function setNetworkSettings(
  expectedRevision: number,
  customProxyUrl: string | null,
): Promise<NetworkSettings> {
  return invoke("set_network_settings", {
    input: { expectedRevision, customProxyUrl },
  });
}

export function previewAiExecution(
  execution: AiExecutionTarget,
  authorization: AiMaterialAuthorization,
): Promise<AiExecutionPreview> {
  return invoke("preview_ai_execution", {
    input: { execution, authorization },
  });
}

export function commandMessage(cause: unknown): string {
  if (typeof cause === "string") {
    return cause;
  }
  if (cause && typeof cause === "object") {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "操作没有完成，请检查配置后重试。";
}
