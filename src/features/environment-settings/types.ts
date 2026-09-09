export type { NetworkSettings } from "../../generated/network-settings";
export type { AiModelInfo, AiModelList } from "../../generated/ai-model-list";
import type { AiProviderId, AiProtocol } from "../../generated/ai-service-settings";
export type { AiProviderId, AiProtocol, AiProviderCatalogEntry, AiServiceCapabilities, AiServiceSummary, AiServiceSettings } from "../../generated/ai-service-settings";
export type { AiServiceTestResult } from "../../generated/ai-service-test-result";

export type AiServiceDraft = {
  id: string | null;
  providerId: AiProviderId;
  displayName: string;
  protocol: AiProtocol;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  makeDefault: boolean;
};

export type AiServiceProbeInput = {
  serviceConfigId: string | null;
  providerId: AiProviderId;
  protocol: AiProtocol;
  baseUrl: string | null;
  modelId: string | null;
  apiKey: string | null;
};

export type AiExecutionTarget =
  | { kind: "manual" }
  | { kind: "codex" }
  | { kind: "api"; serviceConfigId: string; modelId: string };

export type AiMaterialAuthorization = {
  subtitles: boolean;
  currentQuestion: boolean;
  frames: boolean;
  serviceRevision: number | null;
};

export type AiExecutionPreview = {
  executionKind: "manual" | "codex" | "api";
  serviceConfigId: string | null;
  providerId: AiProviderId | null;
  displayName: string;
  modelId: string | null;
  subtitles: boolean;
  currentQuestion: boolean;
  framesRequested: boolean;
  framesEffective: boolean;
  serviceRevision: number | null;
};
