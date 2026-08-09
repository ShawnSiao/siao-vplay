import type { AiProviderCatalogEntry, AiServiceSettings, NetworkSettings } from "./types";

const providers: AiProviderCatalogEntry[] = [
  ["openai", "OpenAI", "openai_responses", "https://api.openai.com/v1"],
  ["anthropic", "Anthropic", "anthropic_messages", "https://api.anthropic.com"],
  ["gemini", "Gemini", "gemini_generate_content", "https://generativelanguage.googleapis.com/v1beta"],
  ["deepseek", "DeepSeek", "openai_chat_completions", "https://api.deepseek.com"],
  ["kimi", "Kimi", "openai_chat_completions", "https://api.moonshot.ai/v1"],
  ["glm", "GLM", "openai_chat_completions", "https://open.bigmodel.cn/api/paas/v4"],
  ["custom", "其他兼容服务", "openai_chat_completions", null],
].map(([id, displayName, protocol, officialBaseUrl]) => ({
  id: id as AiProviderCatalogEntry["id"],
  displayName: displayName as string,
  protocol: protocol as AiProviderCatalogEntry["protocol"],
  officialBaseUrl: officialBaseUrl as string | null,
  modelsPath: "/models",
  documentationUrl: null,
  supportsModelDiscovery: true,
  visionModelPrefixes: [],
}));

export const previewAiSettings: AiServiceSettings = {
  schemaVersion: 1,
  revision: 0,
  providerCatalog: { schemaVersion: 1, providers },
  services: [],
  defaultServiceId: null,
};

export const previewNetworkSettings: NetworkSettings = {
  schemaVersion: 1,
  revision: 0,
  customProxyUrl: null,
  effectiveMode: "direct",
  effectiveSource: "direct",
  effectiveProxyAddress: null,
};
