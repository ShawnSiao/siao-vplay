import { invoke } from "@tauri-apps/api/core";
import type { SummaryActivity } from "../../generated/summary-activity";
export type { SummaryActivity } from "../../generated/summary-activity";
export type SummaryActivitySnapshot = { activities: SummaryActivity[]; incomplete: boolean };

export async function listSummaryActivity(): Promise<SummaryActivitySnapshot> {
  const value: unknown = await invoke("list_summary_activity");
  if (!Array.isArray(value) || value.length > 100) throw new Error("处理动态格式不完整，未采用本次结果。");
  const { default: validate } = await import("../../generated/summary-activity.validator.mjs");
  const counts = new Map<string, number>();
  for (const row of value) {
    if (row && typeof row === "object" && typeof row.id === "string") counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  }
  const activities = value.filter((row): row is SummaryActivity => validate(row) &&
    !!row.id.trim() && !!row.projectId.trim() && !!row.projectTitle.trim() &&
    (!row.hasResult || row.status === "completed") && counts.get(row.id) === 1);
  return { activities, incomplete: activities.length !== value.length };
}
