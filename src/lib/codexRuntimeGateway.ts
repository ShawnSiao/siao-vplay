import { invoke } from "@tauri-apps/api/core";
import type { CodexRuntimeStatus } from "../generated/codex-runtime-status";
export async function getCodexRuntimeStatus(): Promise<CodexRuntimeStatus> {
  const value: unknown = await invoke("get_codex_runtime_status");
  const { default: validate } = await import("../generated/codex-runtime-status.validator.mjs");
  if (!validate(value)) throw new Error("Codex 检测结果格式不完整，请重新检测。");
  if (!value.minimumVersion.trim() || value.available !== (value.supported && value.authenticated) ||
    value.authenticated !== (value.authMode !== null) ||
    (value.authMode !== null && !["chatgpt", "api_key"].includes(value.authMode)) ||
    (value.supported && !value.version?.trim()) ||
    (value.available ? value.errorCode !== null || value.errorMessage !== null : !value.errorCode?.trim() || !value.errorMessage?.trim())) {
    throw new Error("Codex 检测结果不一致，请重新检测。");
  }
  return value;
}
