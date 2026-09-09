/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type ConnectionState = "untested" | "ready" | "error";

export interface AiServiceTestResult {
  capabilities: AiServiceCapabilities;
  mayIncurUsage: boolean;
  minimalRequestUsed: boolean;
  models: AiModelInfo[];
  providerRequestId: string | null;
  selectedModelId: string | null;
  state: ConnectionState;
  [k: string]: unknown;
}
export interface AiServiceCapabilities {
  learning: boolean;
  understanding: boolean;
  vision: boolean;
  [k: string]: unknown;
}
export interface AiModelInfo {
  capabilitySource: string;
  displayName: string;
  id: string;
  vision: boolean;
  [k: string]: unknown;
}
