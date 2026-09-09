import type { CleanupInterruption } from "../../generated/unused-resource-cleanup-result";
import { assertCleanupMatchesPlan } from "../../lib/cleanupOutcome";

export function cleanupFeedback(planned: string[], completed: string[], interruption: CleanupInterruption | null, kind: "unused" | "old") {
  assertCleanupMatchesPlan(planned, completed, interruption);
  if (interruption) {
    return { interrupted: true, message: `清理中断：已完成 ${completed.length} 项，${interruption.remainingItemIds.length} 项尚未确认完成。${interruption.message} 请重新检查清单后再继续。` };
  }
  const message = completed.length > 0
    ? kind === "unused" ? `已清理 ${completed.length} 项未使用资源。` : `已清理 ${completed.length} 个旧资源版本。`
    : kind === "unused" ? "当前没有需要清理的资源。" : "当前没有需要清理的旧版本。";
  return { interrupted: false, message };
}
