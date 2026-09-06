import { translationLanguageLabel } from "../config/translationLanguages";
import type { TranslationTask, TranslationValidation } from "../types";

export function translationResultFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "result.json";
}

export function translationTaskStage(task: TranslationTask): string {
  if (task.status === "awaiting_external_result") {
    return "等待导入 Agent 返回的结果";
  }
  if (task.status === "queued") {
    return "任务已经准备好，等待启动本机 Codex";
  }
  if (task.status === "validating") {
    return "正在检查任务、版本、字幕范围和完整性";
  }
  if (task.status === "completed") {
    return `${translationLanguageLabel(task.targetLanguageCode)}字幕草稿已经生成`;
  }
  if (task.status === "interrupted") return "应用上次关闭时任务尚未完成";
  if (task.status === "cancelled") return "任务已经取消";
  if (task.status === "failed") return "任务处理失败";
  const match = /^translating_batch_(\d+)_of_(\d+)$/.exec(task.stage);
  return match
    ? `正在翻译第 ${match[1]} / ${match[2]} 批字幕`
    : "正在启动本机 Codex";
}

export function translationStatusTone(task: TranslationTask): string {
  if (task.status === "completed") return "ready";
  if (task.status === "failed") return "danger";
  if (task.status === "cancelled" || task.status === "interrupted") {
    return "warning";
  }
  return "agent";
}

export function translationValidationCopy(
  validation: TranslationValidation | null,
): string {
  if (!validation) {
    return "结构检查通过后仍需抽查人名、称谓和人物语气。";
  }
  return validation.warningCount > 0
    ? `结构检查通过，另有 ${validation.warningCount} 项一致性提示。`
    : `已检查 ${validation.translationCount} 条字幕的任务、版本、范围和完整性。`;
}

export async function copyTranslationPrompt(prompt: string): Promise<string> {
  if (!navigator.clipboard?.writeText) return "系统未授权自动复制，可以在下方选择完整提示词。";
  try {
    await navigator.clipboard.writeText(prompt);
    return "完整任务提示词已复制。";
  } catch {
    return "自动复制没有完成，可以在下方选择完整提示词。";
  }
}
