import { invoke } from "@tauri-apps/api/core";

export type TranslationDispatchPreview = {
  taskId: string;
  confirmationSha256: string;
  handoffKind: "codex" | "manual";
  receiver: string;
  model: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  sourceLanguageCode: string;
  targetLanguageCode: string;
  scope: "full_subtitles" | "selected_subtitles";
  segments: Array<{ id: string; startMs: number; endMs: number }>;
  context: Record<string, unknown>;
  glossary: Record<string, unknown>;
};

const text = (value: unknown) => typeof value === "string" && value.length > 0;
const record = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
export async function previewTranslationDispatch(taskId: string) {
  const value = await invoke<TranslationDispatchPreview>("preview_translation_dispatch", { input: { taskId } });
  if (!value || value.taskId !== taskId || !/^[0-9a-f]{64}$/.test(value.confirmationSha256) ||
      !["codex", "manual"].includes(value.handoffKind) || !text(value.receiver) || !text(value.model) ||
      !text(value.sourceVersionId) || !Number.isSafeInteger(value.sourceVersionNumber) || value.sourceVersionNumber < 1 ||
      !text(value.sourceLanguageCode) || !text(value.targetLanguageCode) ||
      !["full_subtitles", "selected_subtitles"].includes(value.scope) ||
      !record(value.context) || !record(value.glossary) ||
      !Array.isArray(value.segments) || value.segments.length === 0 ||
      value.segments.some((item) => !item || !text(item.id) || !Number.isSafeInteger(item.startMs) || item.startMs < 0 || !Number.isSafeInteger(item.endMs) || item.endMs < item.startMs) ||
      new Set(value.segments.map((item) => item.id)).size !== value.segments.length) {
    throw new Error("翻译清单无效，请重新准备材料。");
  }
  return value;
}
