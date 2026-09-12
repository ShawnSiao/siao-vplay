import type { CleanupInterruption } from "../generated/unused-resource-cleanup-result";
const uniqueIds = (values: string[]) => values.every(value => value.trim().length > 0) && new Set(values).size === values.length;

export function validCleanupOutcome(completed: string[], bytes: number, interruption: CleanupInterruption | null): boolean {
  if (!uniqueIds(completed) || (!completed.length && bytes !== 0)) return false;
  return interruption === null || (interruption.itemId.trim().length > 0 && interruption.message.trim().length > 0 &&
    uniqueIds(interruption.remainingItemIds) && interruption.remainingItemIds[0] === interruption.itemId &&
    interruption.remainingItemIds.every(id => !completed.includes(id)));
}
export function assertCleanupMatchesPlan(planned: string[], completed: string[], interruption: CleanupInterruption | null): void {
  const covered = [...completed, ...(interruption?.remainingItemIds ?? [])];
  if (!uniqueIds(covered) || covered.length !== planned.length || covered.some((id, index) => id !== planned[index])) {
    throw new Error("清理结果与确认清单不匹配，请重新检查资源状态。");
  }
}
