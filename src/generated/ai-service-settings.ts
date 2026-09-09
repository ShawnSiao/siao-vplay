/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type AiProviderId = "openai" | "anthropic" | "gemini" | "deepseek" | "kimi" | "glm" | "custom";
export type AiProtocol =
  "openai_responses" | "anthropic_messages" | "gemini_generate_content" | "openai_chat_completions";
export type ConnectionState = "untested" | "ready" | "error";
export type CredentialState = "missing" | "stored";

export interface AiServiceSettings {
  defaultServiceId: string | null;
  providerCatalog: AiProviderCatalog;
  revision: number;
  schemaVersion: number;
  services: AiServiceSummary[];
  [k: string]: unknown;
}
export interface AiProviderCatalog {
  providers: AiProviderCatalogEntry[];
  schemaVersion: number;
  [k: string]: unknown;
}
export interface AiProviderCatalogEntry {
  displayName: string;
  documentationUrl: string | null;
  id: AiProviderId;
  modelsPath: string;
  officialBaseUrl: string | null;
  protocol: AiProtocol;
  supportsModelDiscovery: boolean;
  visionModelPrefixes: string[];
  [k: string]: unknown;
}
export interface AiServiceSummary {
  baseUrl: string;
  capabilities: AiServiceCapabilities;
  connectionState: ConnectionState;
  credentialState: CredentialState;
  displayName: string;
  id: string;
  isDefault: boolean;
  modelId: string | null;
  protocol: AiProtocol;
  providerId: AiProviderId;
  revision: number;
  [k: string]: unknown;
}
export interface AiServiceCapabilities {
  learning: boolean;
  understanding: boolean;
  vision: boolean;
  [k: string]: unknown;
}
