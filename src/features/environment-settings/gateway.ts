import validateServiceSettings from "../../generated/ai-service-settings.validator.mjs";
import validateServiceTest from "../../generated/ai-service-test-result.validator.mjs";
import validateNetworkSettings from "../../generated/network-settings.validator.mjs";
import validateModelList from "../../generated/ai-model-list.validator.mjs";
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

function parseServiceSettings(value: unknown): AiServiceSettings {
  if (!validateServiceSettings(value)) throw new Error("AI 服务设置格式无效");
  return value;
}

export async function getAiServiceSettings(): Promise<AiServiceSettings> {
  return parseServiceSettings(await invoke<unknown>("get_ai_service_settings"));
}

export async function saveAiService(
  expectedRevision: number,
  draft: AiServiceDraft,
): Promise<AiServiceSettings> {
  return parseServiceSettings(await invoke<unknown>("save_ai_service", {
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
  }));
}

export async function deleteAiService(
  expectedRevision: number,
  id: string,
): Promise<AiServiceSettings> {
  return parseServiceSettings(await invoke<unknown>("delete_ai_service", { input: { expectedRevision, id } }));
}

export async function setDefaultAiService(
  expectedRevision: number,
  id: string | null,
): Promise<AiServiceSettings> {
  return parseServiceSettings(await invoke<unknown>("set_default_ai_service", {
    input: { expectedRevision, id },
  }));
}

export async function listAiServiceModels(
  input: AiServiceProbeInput,
): Promise<AiModelList> {
  const result = await invoke<unknown>("list_ai_service_models", { input });
  if (!validateModelList(result)) throw new Error("模型列表格式无效");
  return result;
}

export async function testAiService(
  input: AiServiceProbeInput,
): Promise<AiServiceTestResult> {
  const result = await invoke<unknown>("test_ai_service", { input });
  if (!validateServiceTest(result)) throw new Error("连接测试结果格式无效");
  return result;
}

function parseNetworkSettings(value: unknown): NetworkSettings {
  if (!validateNetworkSettings(value)) throw new Error("网络设置格式无效");
  return value;
}

export async function getNetworkSettings(): Promise<NetworkSettings> {
  return parseNetworkSettings(await invoke<unknown>("get_network_settings"));
}

export async function setNetworkSettings(
  expectedRevision: number,
  customProxyUrl: string | null,
): Promise<NetworkSettings> {
  return parseNetworkSettings(await invoke<unknown>("set_network_settings", {
    input: { expectedRevision, customProxyUrl },
  }));
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
