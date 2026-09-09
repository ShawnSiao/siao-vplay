export type { NetworkSettings } from "../../generated/network-settings";
import type { AiModelInfo } from "../../generated/ai-model-list";
export type { AiModelInfo, AiModelList } from "../../generated/ai-model-list";
export type AiProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "glm"
  | "custom";

export type AiProtocol =
  | "openai_responses"
  | "anthropic_messages"
  | "gemini_generate_content"
  | "openai_chat_completions";

export type AiProviderCatalogEntry = {
  id: AiProviderId;
  displayName: string;
  protocol: AiProtocol;
  officialBaseUrl: string | null;
  modelsPath: string;
  documentationUrl: string | null;
  supportsModelDiscovery: boolean;
  visionModelPrefixes: string[];
};

export type AiServiceCapabilities = {
  understanding: boolean;
  learning: boolean;
  vision: boolean;
};

export type AiServiceSummary = {
  id: string;
  providerId: AiProviderId;
  displayName: string;
  protocol: AiProtocol;
  baseUrl: string;
  modelId: string | null;
  credentialState: "missing" | "stored";
  connectionState: "untested" | "ready" | "error";
  capabilities: AiServiceCapabilities;
  isDefault: boolean;
  revision: number;
};

export type AiServiceSettings = {
  schemaVersion: number;
  revision: number;
  providerCatalog: {
    schemaVersion: number;
    providers: AiProviderCatalogEntry[];
  };
  services: AiServiceSummary[];
  defaultServiceId: string | null;
};

export type AiServiceTestResult = {
  state: "untested" | "ready" | "error";
  models: AiModelInfo[];
  selectedModelId: string | null;
  capabilities: AiServiceCapabilities;
  minimalRequestUsed: boolean;
  mayIncurUsage: boolean;
  providerRequestId: string | null;
};

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
