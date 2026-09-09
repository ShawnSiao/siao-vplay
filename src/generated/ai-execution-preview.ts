/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type AiExecutionKind = "manual" | "codex" | "api";
export type AiProviderId = "openai" | "anthropic" | "gemini" | "deepseek" | "kimi" | "glm" | "custom";

export interface AiExecutionPreview {
  currentQuestion: boolean;
  displayName: string;
  executionKind: AiExecutionKind;
  framesEffective: boolean;
  framesRequested: boolean;
  modelId: string | null;
  providerId: AiProviderId | null;
  serviceConfigId: string | null;
  serviceRevision: number | null;
  subtitles: boolean;
  [k: string]: unknown;
}
